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
	// Runs against a real Editor, so it is the only guard on InlineCodeExtension
	// keeping `excludes: ""`. Restoring tiptap's default drops the review mark
	// from the code segments and splits the span; the editor package's
	// equivalent test builds JSON by hand and cannot catch that.
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
