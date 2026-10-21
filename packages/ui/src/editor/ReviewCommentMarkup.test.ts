// @vitest-environment happy-dom

import {
	InlineCodeExtension,
	LinkExtension,
	markdownToTiptapDoc,
	ReviewMarkExtension,
	tiptapDocToMarkdown,
} from "@hubble.md/editor";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
});

describe("review comment marking", () => {
	it("keeps one comment span across inline code and wiki links", () => {
		const body =
			"Open `file-index.html` or `todo-demo.html` from the sidebar to try full-screen HTML Apps. See [[samples/interview-prep]] for prompts.";
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [
				StarterKit.configure({ code: false, link: false }),
				InlineCodeExtension,
				LinkExtension,
				ReviewMarkExtension,
			],
			content: markdownToTiptapDoc(body),
		});
		editors.push(editor);

		const markType = editor.state.schema.marks.reviewMark;
		editor.view.dispatch(
			editor.state.tr.addMark(
				1,
				editor.state.doc.content.size - 1,
				markType.create({
					type: "reviewComment",
					body: "A note",
					id: "c1",
				}),
			),
		);

		expect(tiptapDocToMarkdown(editor.getJSON() as JSONContent)).toBe(
			`{==${body}==}{>>A note<<}{#c1}`,
		);
	});
});

describe("review comment markup in the note", () => {
	it("does not show raw comment syntax when a body spans blocks", () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [
				StarterKit.configure({ code: false, link: false }),
				InlineCodeExtension,
				LinkExtension,
				ReviewMarkExtension,
			],
			content: markdownToTiptapDoc(
				"A {==anchor==}{>>line one\n\nline two<<}{#c4} end.",
			),
		});
		editors.push(editor);

		const visible = editor.view.dom.textContent ?? "";
		expect(visible).not.toContain("{>>");
		expect(visible).not.toContain("<<}");
		expect(visible).not.toContain("{#c4}");
		expect(
			editor.view.dom.querySelectorAll('[data-review-type="reviewComment"]'),
		).toHaveLength(1);
	});

	it("does not show a Roughdraft-style id attribute in the note", () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [
				StarterKit.configure({ code: false, link: false }),
				InlineCodeExtension,
				LinkExtension,
				ReviewMarkExtension,
			],
			content: markdownToTiptapDoc(
				'A {==anchor==}{>>body<<}{id="c4" by="user" at="2026-09-21T03:14:22.721Z"}',
			),
		});
		editors.push(editor);

		expect(editor.view.dom.textContent ?? "").not.toContain("{id=");
		const mark = editor.view.dom.querySelector(
			'[data-review-type="reviewComment"]',
		);
		expect(mark?.getAttribute("data-review-id")).toBe("c4");
	});

	it("does not show thread metadata that sits on its own line", () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [
				StarterKit.configure({ code: false, link: false }),
				InlineCodeExtension,
				LinkExtension,
				ReviewMarkExtension,
			],
			content: markdownToTiptapDoc(
				'A {==anchor==}{>>body<<}{#c1}\n\n<!-- hubble-review:{"v":1,"replies":[],"resolved":true}-->',
			),
		});
		editors.push(editor);

		expect(editor.view.dom.textContent ?? "").not.toContain("hubble-review");
		const mark = editor.view.dom.querySelector(
			'[data-review-type="reviewComment"]',
		);
		expect(mark?.hasAttribute("data-review-resolved")).toBe(true);
	});
});
