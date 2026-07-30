import type { Editor } from "@tiptap/react";

/**
 * The rich-text editor currently mounted, if any.
 *
 * Editor commands are normally reached through the keymap or a menu that
 * already holds an `Editor`. The command palette has neither: it runs from a
 * dialog that has taken focus away from the document, so it needs a way to
 * reach the editor that was active when it opened.
 *
 * Hubble mounts at most one rich-text editor at a time, so a single slot is
 * enough. If split view ever lands this becomes a focused-editor lookup rather
 * than a lone reference.
 */
let active: Editor | null = null;

export function setActiveEditor(editor: Editor | null) {
	active = editor;
}

/**
 * Clears the slot only if `editor` still owns it.
 *
 * An unmounting editor must not blank out a newer one: switching notes mounts
 * the replacement before React runs the old effect's cleanup, so an
 * unconditional clear would leave no active editor at all.
 */
export function clearActiveEditor(editor: Editor | null) {
	if (active === editor) active = null;
}

export function getActiveEditor(): Editor | null {
	// A destroyed editor throws on any command call, and unmount ordering means
	// we can still be holding one; treat it as absent.
	if (active?.isDestroyed) return null;
	return active;
}

/**
 * Formatting actions a caller outside the editor can trigger by name.
 *
 * Named actions rather than an exposed TipTap chain: the `Commands` interface
 * is assembled by declaration merging from the extension packages this module
 * imports, so a caller in another package sees a bare `ChainedCommands` and
 * cannot type `toggleBold`. Keeping the chain here also means consumers never
 * depend on which extension provides a given mark.
 */
const EDITOR_ACTIONS = {
	bold: (chain) => chain.toggleBold(),
	italic: (chain) => chain.toggleItalic(),
	code: (chain) => chain.toggleCode(),
	strike: (chain) => chain.toggleStrike(),
	"heading-1": (chain) => chain.toggleHeading({ level: 1 }),
	"heading-2": (chain) => chain.toggleHeading({ level: 2 }),
	"heading-3": (chain) => chain.toggleHeading({ level: 3 }),
	// Hubble's own list commands, not TipTap's. `ListToggleExtension` retypes
	// the nearest enclosing list rather than wrapping the block, and its task
	// list is a bullet list of `task` items rather than TipTap's `taskList`
	// node — so `toggleTaskList` silently does nothing here. These are the exact
	// commands `Mod-Shift-7/8/9` already run.
	"bullet-list": (chain) => chain.toggleParentBulletList(),
	"ordered-list": (chain) => chain.toggleParentOrderedList(),
	"task-list": (chain) => chain.toggleParentTaskList(),
	blockquote: (chain) => chain.toggleBlockquote(),
} satisfies Record<
	string,
	(chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>
>;

export type EditorActionId = keyof typeof EDITOR_ACTIONS;

export const editorActionIds = Object.keys(EDITOR_ACTIONS) as EditorActionId[];

/**
 * Runs a named formatting action against the active editor.
 *
 * Focus is restored first: the palette closes before the command runs, so the
 * selection is still in the document but focus is not, and without `focus()` a
 * mark toggle would apply to a collapsed selection the user cannot see.
 *
 * Returns false when no editor is mounted, so callers can stay silent rather
 * than reporting a failure the user cannot act on.
 */
export function runEditorAction(action: EditorActionId): boolean {
	const editor = getActiveEditor();
	if (!editor) return false;
	return EDITOR_ACTIONS[action](editor.chain().focus()).run();
}
