// @vitest-environment happy-dom

import { listExtensions } from "@hubble.md/editor";
import { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import { afterEach, describe, expect, it } from "vitest";
import {
	EditorCommandShortcuts,
	starterKitWithRegistryShortcuts,
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
			...starterKitWithRegistryShortcuts({ listItem: false }),
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
