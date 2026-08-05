import type { Editor } from "@tiptap/react";

let active: Editor | null = null;

export function setActiveEditor(editor: Editor | null) {
	active = editor;
}

export function clearActiveEditor(editor: Editor | null) {
	// An old editor may clean up after its replacement mounts.
	if (active === editor) active = null;
}

export function getActiveEditor(): Editor | null {
	if (active?.isDestroyed) return null;
	return active;
}

const EDITOR_ACTIONS = {
	bold: (chain) => chain.toggleBold(),
	italic: (chain) => chain.toggleItalic(),
	code: (chain) => chain.toggleCode(),
	strike: (chain) => chain.toggleStrike(),
	"heading-1": (chain) => chain.toggleHeading({ level: 1 }),
	"heading-2": (chain) => chain.toggleHeading({ level: 2 }),
	"heading-3": (chain) => chain.toggleHeading({ level: 3 }),
	// TipTap's task list does not match Hubble's schema.
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

export function runEditorAction(action: EditorActionId): boolean {
	const editor = getActiveEditor();
	if (!editor) return false;
	// The palette takes focus before running the command.
	return EDITOR_ACTIONS[action](editor.chain().focus()).run();
}
