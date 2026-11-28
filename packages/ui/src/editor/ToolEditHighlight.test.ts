// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { replaceEditorContent } from "./replaceEditorContent";
import { ToolEditHighlight } from "./ToolEditHighlight";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
	document.body.replaceChildren();
	vi.useRealTimers();
});

function doc(...paragraphs: string[]) {
	return {
		type: "doc",
		content: paragraphs.map((text) => ({
			type: "paragraph",
			content: [{ type: "text", text }],
		})),
	};
}
function setup(...paragraphs: string[]) {
	const editor = new Editor({
		extensions: [StarterKit, ToolEditHighlight],
		content: doc(...paragraphs),
	});
	editors.push(editor);
	document.body.append(editor.view.dom);
	return editor;
}
function highlights(editor: Editor) {
	return [...editor.view.dom.querySelectorAll(".hubble-tool-edit")]
		.map((node) => node.textContent)
		.join("");
}

it("pulses added and updated lines without highlighting unchanged passages or stealing focus", () => {
	const editor = setup(
		"Original introduction",
		"Old word in the middle",
		"Unchanged ending",
	);
	const control = document.createElement("button");
	document.body.append(control);
	control.focus();
	replaceEditorContent(
		editor,
		doc(
			"Original introduction",
			"New word in the middle",
			"Added line",
			"Unchanged ending",
		),
		true,
		true,
	);
	expect(highlights(editor)).toContain("New");
	expect(highlights(editor)).toContain("Added line");
	expect(highlights(editor)).not.toContain("Original");
	expect(highlights(editor)).toContain("New word in the middle");
	expect(highlights(editor)).not.toContain("Unchanged");
	expect(document.activeElement).toBe(control);
});

it("does not pulse deletions, ordinary typing, or disk reloads", () => {
	const editor = setup("Keep this", "Remove this", "Keep that");
	replaceEditorContent(editor, doc("Keep this", "Keep that"), true, true);
	expect(highlights(editor)).toBe("");
	editor.view.dispatch(editor.state.tr.insertText("Typing ", 1));
	expect(highlights(editor)).toBe("");
	replaceEditorContent(editor, doc("Reloaded file"), false, true);
	expect(highlights(editor)).toBe("");
});

it("maps highlights through typing, expires after the latest edit, and preserves tool undo", () => {
	vi.useFakeTimers();
	const editor = setup("Before");
	replaceEditorContent(editor, doc("Before", "First addition"), true, true);
	editor.view.dispatch(
		editor.state.tr.insertText("Typed ", 1).setMeta("addToHistory", false),
	);
	expect(highlights(editor)).toBe("First addition");
	vi.advanceTimersByTime(400);
	replaceEditorContent(
		editor,
		doc("Typed Before", "Second addition"),
		true,
		true,
	);
	expect(highlights(editor)).toContain("Second");
	vi.advanceTimersByTime(400);
	expect(highlights(editor)).not.toBe("");
	vi.advanceTimersByTime(401);
	expect(highlights(editor)).toBe("");
	editor.commands.undo();
	expect(editor.getText()).toContain("First addition");
	expect(editor.getText()).not.toContain("Second addition");
	expect(highlights(editor)).toBe("");
});

it("limits a source-editor pulse to changed lines inside its code block", () => {
	const editor = setup("placeholder");
	const source = (text: string) => ({
		type: "doc",
		content: [{ type: "codeBlock", content: [{ type: "text", text }] }],
	});
	editor.commands.setContent(source("keep first\nold line\nkeep last"));
	replaceEditorContent(
		editor,
		source("keep first\nupdated line\nkeep last"),
		true,
		true,
	);
	expect(highlights(editor)).toBe("updated line");
});

it("does not pulse the unchanged line after a source-line insertion", () => {
	const editor = setup("placeholder");
	const source = (text: string) => ({
		type: "doc",
		content: [{ type: "codeBlock", content: [{ type: "text", text }] }],
	});
	editor.commands.setContent(source("keep first\nkeep last"));
	replaceEditorContent(
		editor,
		source("keep first\nadded line\nkeep last"),
		true,
		true,
	);
	expect(highlights(editor)).toBe("added line");
});

it("does not pulse unchanged text between nearby deletions", () => {
	const editor = setup("Hello (a) world");
	replaceEditorContent(editor, doc("Hello a world"), true, true);
	expect(highlights(editor)).toBe("");
});

it("restarts the pulse animation for another edit to the same line", () => {
	vi.useFakeTimers();
	const editor = setup("Before");
	replaceEditorContent(editor, doc("First update"), true, true);
	const firstClass =
		editor.view.dom.querySelector(".hubble-tool-edit")?.className;
	vi.advanceTimersByTime(400);
	replaceEditorContent(editor, doc("Second update"), true, true);
	const secondClass =
		editor.view.dom.querySelector(".hubble-tool-edit")?.className;
	expect(secondClass).not.toBe(firstClass);
	expect(highlights(editor)).toBe("Second update");
	vi.advanceTimersByTime(400);
	expect(highlights(editor)).toBe("Second update");
	vi.advanceTimersByTime(400);
	expect(highlights(editor)).toBe("");
});

it("skips pulse refinement when a large rewrite exhausts its time budget", () => {
	const editor = setup("a".repeat(20_000));
	let elapsed = 0;
	const clock = vi.spyOn(Date, "now").mockImplementation(() => {
		elapsed += 25;
		// Fail quickly if refinement loses its timeout, without depending on CI speed.
		if (elapsed > 10_000)
			throw new Error("Pulse refinement exceeded its time budget");
		return elapsed;
	});
	try {
		replaceEditorContent(editor, doc("b".repeat(20_000)), true, true);
		expect(editor.getText()).toBe("b".repeat(20_000));
		expect(highlights(editor)).toBe("");
	} finally {
		clock.mockRestore();
	}
});
