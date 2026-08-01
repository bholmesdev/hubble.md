import { expect, test } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror.js";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown.js";

test("parses markdown table", () => {
	const result = markdownToTiptapDoc("| A | B |\n|---|---|\n| 1 | 2 |");

	expect(result.content?.[0]).toMatchObject({
		type: "table",
		content: [
			{
				type: "tableRow",
				content: [{ type: "tableHeader" }, { type: "tableHeader" }],
			},
			{
				type: "tableRow",
				content: [{ type: "tableCell" }, { type: "tableCell" }],
			},
		],
	});
});

test("parses html line breaks inside markdown table cells", () => {
	const doc = markdownToTiptapDoc(
		"| First | second |\n|---|---|\n| hey<br><br>more text | hey |",
	);

	expect(doc.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]).toEqual({
		type: "paragraph",
		content: [
			{ type: "text", text: "hey" },
			{ type: "hardBreak" },
			{ type: "hardBreak" },
			{ type: "text", text: "more text" },
		],
	});
});

test("round-trips table cell line breaks", () => {
	const input = "| First | second |\n|---|---|\n| hey<br><br>more text | hey |";
	const doc = markdownToTiptapDoc(input);

	expect(tiptapDocToMarkdown(doc)).toBe(input);
});
