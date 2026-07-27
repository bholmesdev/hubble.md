import { tiptapBinding } from "@hubble.md/editor";
import { Extension } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Bold } from "@tiptap/extension-bold";
import { Code } from "@tiptap/extension-code";
import { Heading } from "@tiptap/extension-heading";
import { Italic } from "@tiptap/extension-italic";

const withoutShortcuts = { addKeyboardShortcuts: () => ({}) };

export const RegistryBlockquote = Blockquote.extend(withoutShortcuts);
export const RegistryBold = Bold.extend(withoutShortcuts);
export const RegistryCode = Code.extend(withoutShortcuts);
export const RegistryHeading = Heading.extend(withoutShortcuts);
export const RegistryItalic = Italic.extend(withoutShortcuts);

export const EditorCommandShortcuts = Extension.create({
	name: "editorCommandShortcuts",
	priority: 2000,

	addKeyboardShortcuts() {
		return {
			[tiptapBinding("editor.link")]: () =>
				this.editor.commands.toggleLinkAtSelection(),
			[tiptapBinding("editor.strike")]: () =>
				this.editor.commands.toggleMark("strike"),
			[tiptapBinding("editor.ordered-list")]: () =>
				this.editor.commands.toggleParentOrderedList(),
			[tiptapBinding("editor.bullet-list")]: () =>
				this.editor.commands.toggleParentBulletList(),
			[tiptapBinding("editor.task-list")]: () =>
				this.editor.commands.toggleParentTaskList(),
			[tiptapBinding("editor.bold")]: () => this.editor.commands.toggleBold(),
			[tiptapBinding("editor.italic")]: () =>
				this.editor.commands.toggleItalic(),
			[tiptapBinding("editor.code")]: () => this.editor.commands.toggleCode(),
			[tiptapBinding("editor.heading-1")]: () =>
				this.editor.commands.toggleHeading({ level: 1 }),
			[tiptapBinding("editor.heading-2")]: () =>
				this.editor.commands.toggleHeading({ level: 2 }),
			[tiptapBinding("editor.heading-3")]: () =>
				this.editor.commands.toggleHeading({ level: 3 }),
			[tiptapBinding("editor.heading-4")]: () =>
				this.editor.commands.toggleHeading({ level: 4 }),
			[tiptapBinding("editor.heading-5")]: () =>
				this.editor.commands.toggleHeading({ level: 5 }),
			[tiptapBinding("editor.heading-6")]: () =>
				this.editor.commands.toggleHeading({ level: 6 }),
			[tiptapBinding("editor.blockquote")]: () =>
				this.editor.commands.toggleBlockquote(),
		};
	},
});
