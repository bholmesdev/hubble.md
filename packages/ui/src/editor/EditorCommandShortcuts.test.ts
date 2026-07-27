// @vitest-environment happy-dom

import { listExtensions } from "@hubble.md/editor";
import { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
	EditorCommandShortcuts,
	RegistryBlockquote,
	RegistryBold,
	RegistryCode,
	RegistryHeading,
	RegistryItalic,
} from "./EditorCommandShortcuts";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
});

describe("EditorCommandShortcuts", () => {
	it("preserves StarterKit mark and heading shortcuts", () => {
		const editor = createEditor();
		editor.commands.selectAll();

		expect(editor.commands.keyboardShortcut("Mod-b")).toBe(true);
		expect(editor.isActive("bold")).toBe(true);
		const headingEditor = createEditor();
		expect(headingEditor.commands.keyboardShortcut("Mod-Alt-2")).toBe(true);
		expect(headingEditor.isActive("heading", { level: 2 })).toBe(true);
	});

	it("preserves Hubble list shortcuts", () => {
		const editor = createEditor();

		expect(editor.commands.keyboardShortcut("Mod-Shift-8")).toBe(true);
		expect(editor.isActive("bulletList")).toBe(true);
	});
});

function createEditor() {
	const editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({
				blockquote: false,
				bold: false,
				code: false,
				heading: false,
				italic: false,
				listItem: false,
			}),
			RegistryBlockquote,
			RegistryBold,
			RegistryCode,
			RegistryHeading,
			RegistryItalic,
			...listExtensions,
			TaskItem.configure({ nested: true }),
			EditorCommandShortcuts,
		],
		content: "<p>hello</p>",
	});
	editors.push(editor);
	Object.defineProperty(editor, "isFocused", { value: true });
	return editor;
}
