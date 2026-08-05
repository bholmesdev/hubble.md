// @vitest-environment happy-dom

import { markdownToTiptapDoc } from "@hubble.md/editor";
import { Editor, type JSONContent, Node } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { Fragment } from "@tiptap/pm/model";
import { afterEach, expect, it } from "vitest";
import { starterKitWithRegistryShortcuts } from "./EditorCommandShortcuts";
import {
	MarkdownTableCell,
	MarkdownTableHeader,
} from "./TableMarkdownExtensions";

const Image = Node.create({
	name: "image",
	group: "block tableCellContent",
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
			...starterKitWithRegistryShortcuts(),
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

it("rejects other block types in Markdown table cells", () => {
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			...starterKitWithRegistryShortcuts(),
			Image,
			Table,
			TableRow,
			MarkdownTableHeader,
			MarkdownTableCell,
		],
	});

	const paragraph = editor.schema.nodes.paragraph?.create();
	const listItem = editor.schema.nodes.listItem?.create(null, paragraph);
	const bulletList = editor.schema.nodes.bulletList?.create(null, listItem);
	const tableCell = editor.schema.nodes.tableCell;
	if (!bulletList || !tableCell) throw new Error("Missing table test nodes");

	expect(tableCell.validContent(Fragment.from(bulletList))).toBe(false);
});
