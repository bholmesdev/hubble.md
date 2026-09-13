// @vitest-environment happy-dom

import {
	InlineCodeExtension,
	listExtensions,
	setCommandBindings,
} from "@hubble.md/editor";
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
	setCommandBindings({});
});

describe("EditorCommandShortcuts", () => {
	it.each([
		["Mod-b", "bold"],
		["Mod-i", "italic"],
		["Mod-e", "code"],
		["Mod-Shift-x", "strike"],
	])("preserves the %s mark shortcut", (shortcut, mark) => {
		const editor = createEditor();
		editor.commands.selectAll();

		expect(editor.commands.keyboardShortcut(shortcut)).toBe(true);
		expect(editor.isActive(mark)).toBe(true);
	});

	it.each([1, 3])("preserves the heading %d shortcut", (level) => {
		const editor = createEditor();

		expect(editor.commands.keyboardShortcut(`Mod-Alt-${level}`)).toBe(true);
		expect(editor.isActive("heading", { level })).toBe(true);
	});

	it("preserves the blockquote shortcut", () => {
		const editor = createEditor();

		expect(editor.commands.keyboardShortcut("Mod-Shift-b")).toBe(true);
		expect(editor.isActive("blockquote")).toBe(true);
	});

	it.each([
		["Mod-Shift-7", "orderedList"],
		["Mod-Shift-8", "bulletList"],
	])("preserves the %s list shortcut", (shortcut, list) => {
		const editor = createEditor();

		expect(editor.commands.keyboardShortcut(shortcut)).toBe(true);
		expect(editor.isActive(list)).toBe(true);
	});

	it("preserves the task list shortcut", () => {
		const editor = createEditor();

		// Task lists are bullet lists whose items carry a checked state. The
		// synthetic keyboardShortcut command drops the chained checked-state
		// step (same before and after the registry move), so only the wrap is
		// asserted here; conversion is covered by the slash command tests.
		expect(editor.commands.keyboardShortcut("Mod-Shift-9")).toBe(true);
		expect(editor.isActive("bulletList")).toBe(true);
	});

	it("applies a remap to an editor that is already open", () => {
		const editor = createEditor();
		editor.commands.selectAll();
		setCommandBindings({ "editor.bold": "CmdOrCtrl+Alt+B" });

		editor.commands.keyboardShortcut("Mod-b");
		expect(editor.isActive("bold")).toBe(false);

		editor.commands.keyboardShortcut("Mod-Alt-b");
		expect(editor.isActive("bold")).toBe(true);
	});

	it("does not run a disabled shortcut", () => {
		const editor = createEditor();
		editor.commands.selectAll();
		setCommandBindings({ "editor.italic": null });

		editor.commands.keyboardShortcut("Mod-i");
		expect(editor.isActive("italic")).toBe(false);
	});

	it("runs only the first command when shortcuts conflict", () => {
		const editor = createEditor();
		editor.commands.selectAll();
		setCommandBindings({
			"editor.bold": "CmdOrCtrl+Alt+M",
			"editor.italic": "CmdOrCtrl+Alt+M",
		});

		editor.commands.keyboardShortcut("Mod-Alt-m");

		expect(editor.isActive("bold")).toBe(true);
		expect(editor.isActive("italic")).toBe(false);
	});
});

// Mirrors the EditorView setup: registry-owned StarterKit shortcuts plus
// Hubble's own code mark and list extensions.
function createEditor() {
	const editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			...starterKitWithRegistryShortcuts({ code: false, listItem: false }),
			InlineCodeExtension,
			...listExtensions,
			TaskItem.configure({ nested: true }),
			EditorCommandShortcuts,
		],
		content: "<p>hello</p>",
	});
	editors.push(editor);
	Object.defineProperty(editor, "isFocused", { value: true });
	editor.commands.focus("end");
	return editor;
}
