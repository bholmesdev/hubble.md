// @vitest-environment happy-dom

import { markdownToTiptapDoc } from "@hubble.md/editor";
import { Editor, type JSONContent, Node } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import {
	MarkdownTableCell,
	MarkdownTableHeader,
} from "./TableMarkdownExtensions";

const Image = Node.create({
	name: "image",
	group: "block",
	atom: true,
	renderHTML: ({ HTMLAttributes }) => ["img", HTMLAttributes],
	addAttributes: () => ({
		src: { default: "" },
		alt: { default: "" },
	}),
});

let editor: Editor | undefined;

afterEach(() => editor?.destroy());

it("loads images in Markdown table cells", () => {
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit,
			Image,
			Table,
			TableRow,
			MarkdownTableHeader,
			MarkdownTableCell,
		],
		content: markdownToTiptapDoc(
			"| Header |\n| --- |\n| Before ![diagram](example.png) after |",
		),
	});

	const doc = editor.getJSON() as JSONContent;
	const cell = doc.content?.[0]?.content?.[1]?.content?.[0];
	expect(cell).toMatchObject({
		type: "tableCell",
		content: [
			{ type: "paragraph", content: [{ type: "text", text: "Before" }] },
			{ type: "image", attrs: { src: "example.png", alt: "diagram" } },
			{ type: "paragraph", content: [{ type: "text", text: "after" }] },
		],
	});
});
