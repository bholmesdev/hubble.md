// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { HubbleCodeBlock } from "./CodeBlockExtension";
import {
	markdownFromSourceDoc,
	sourceDocFromMarkdown,
} from "./MarkdownSourceEditor";

const editors: Editor[] = [];
const SourceDocument = Document.extend({ content: "codeBlock" });

afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
});

describe("MarkdownSourceEditor document helpers", () => {
	it("stores the whole markdown file in one markdown code block", () => {
		const markdown = "---\ntitle: Test\n---\n\n# Hello\n\nBody";

		expect(sourceDocFromMarkdown(markdown)).toEqual({
			type: "doc",
			content: [
				{
					type: "codeBlock",
					attrs: { language: "md" },
					content: [{ type: "text", text: markdown }],
				},
			],
		});
	});

	it("stores HTML with HTML syntax highlighting", () => {
		const html = "<!doctype html>\n<title>Test</title>";

		expect(sourceDocFromMarkdown(html, "html")).toEqual({
			type: "doc",
			content: [
				{
					type: "codeBlock",
					attrs: { language: "html" },
					content: [{ type: "text", text: html }],
				},
			],
		});
	});

	it("reads the whole markdown file back from the code block", () => {
		const markdown = "---\ntitle: Test\n---\n\n# Hello\n\nBody";
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [
				SourceDocument,
				StarterKit.configure({ codeBlock: false, document: false }),
				HubbleCodeBlock.configure({ defaultLanguage: "md" }),
			],
			content: sourceDocFromMarkdown(markdown),
		});
		editors.push(editor);

		expect(markdownFromSourceDoc(editor)).toBe(markdown);
	});

	it("keeps replacement typing inside the code block", () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [
				SourceDocument,
				StarterKit.configure({ codeBlock: false, document: false }),
				HubbleCodeBlock.configure({ defaultLanguage: "md" }),
			],
			content: sourceDocFromMarkdown("before"),
		});
		editors.push(editor);

		editor.commands.selectAll();
		editor.commands.insertContent("after");

		expect(editor.getJSON().content?.[0]).toMatchObject({
			type: "codeBlock",
			attrs: { language: "md" },
			content: [{ type: "text", text: "after" }],
		});
	});
});
