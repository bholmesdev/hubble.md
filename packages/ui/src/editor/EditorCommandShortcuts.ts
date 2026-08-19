import { type EditorCommandId, getCommandBinding } from "@hubble.md/editor";
import { Extension } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Bold } from "@tiptap/extension-bold";
import { Heading } from "@tiptap/extension-heading";
import { Italic } from "@tiptap/extension-italic";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { keymatch } from "keymatch";

const withoutShortcuts = { addKeyboardShortcuts: () => ({}) };

const MarkdownStarterKit = StarterKit.extend({
	addExtensions() {
		return (this.parent?.() ?? []).map((extension) =>
			extension.name === "paragraph"
				? extension.extend({ group: "block tableCellContent" })
				: extension,
		);
	},
});

// StarterKit binds its own mark and heading shortcuts. Swap those extensions
// for shortcut-free versions so EditorCommandShortcuts owns every binding.
// The code mark is Hubble's own InlineCodeExtension, added by the caller.
export function starterKitWithRegistryShortcuts(
	options?: Parameters<typeof StarterKit.configure>[0],
) {
	return [
		MarkdownStarterKit.configure({
			...options,
			blockquote: false,
			bold: false,
			heading: false,
			italic: false,
		}),
		Blockquote.extend(withoutShortcuts),
		Bold.extend(withoutShortcuts),
		Heading.extend(withoutShortcuts),
		Italic.extend(withoutShortcuts),
	];
}

export const EditorCommandShortcuts = Extension.create({
	name: "editorCommandShortcuts",
	priority: 2000,

	addProseMirrorPlugins() {
		const run = (id: EditorCommandId) => {
			switch (id) {
				case "editor.link":
					return this.editor.commands.toggleLinkAtSelection();
				case "editor.strike":
					return this.editor.commands.toggleMark("strike");
				case "editor.ordered-list":
					return this.editor.commands.toggleParentOrderedList();
				case "editor.bullet-list":
					return this.editor.commands.toggleParentBulletList();
				case "editor.task-list":
					return this.editor.commands.toggleParentTaskList();
				case "editor.bold":
					return this.editor.commands.toggleBold();
				case "editor.italic":
					return this.editor.commands.toggleItalic();
				case "editor.code":
					return this.editor.commands.toggleCode();
				case "editor.heading-1":
					return this.editor.commands.toggleHeading({ level: 1 });
				case "editor.heading-2":
					return this.editor.commands.toggleHeading({ level: 2 });
				case "editor.heading-3":
					return this.editor.commands.toggleHeading({ level: 3 });
				case "editor.heading-4":
					return this.editor.commands.toggleHeading({ level: 4 });
				case "editor.heading-5":
					return this.editor.commands.toggleHeading({ level: 5 });
				case "editor.heading-6":
					return this.editor.commands.toggleHeading({ level: 6 });
				case "editor.blockquote":
					return this.editor.commands.toggleBlockquote();
			}
		};

		return [
			new Plugin({
				props: {
					handleKeyDown: (_view, event) => {
						for (const id of editorCommandIds) {
							const binding = getCommandBinding(id);
							if (binding && keymatch(event, binding)) return run(id);
						}
						return false;
					},
				},
			}),
		];
	},
});

const editorCommandIds: EditorCommandId[] = [
	"editor.link",
	"editor.strike",
	"editor.ordered-list",
	"editor.bullet-list",
	"editor.task-list",
	"editor.bold",
	"editor.italic",
	"editor.code",
	"editor.heading-1",
	"editor.heading-2",
	"editor.heading-3",
	"editor.heading-4",
	"editor.heading-5",
	"editor.heading-6",
	"editor.blockquote",
];
