import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown.js";

type Mark = NonNullable<JSONContent["marks"]>[number];

function paragraph(content: JSONContent[]): JSONContent {
	return { type: "doc", content: [{ type: "paragraph", content }] };
}

function text(value: string, ...marks: Mark[]): JSONContent {
	return marks.length
		? { type: "text", text: value, marks }
		: { type: "text", text: value };
}

describe("emphasis markdown conversion", () => {
	it("serializes bold text with trailing whitespace outside the closing delimiter", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([text("bold ", { type: "bold" }), text("next")]),
		);

		expect(markdown).toBe("**bold** next");
	});

	it("serializes italic and strike text with trailing whitespace outside the closing delimiter", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([
				text("italic ", { type: "italic" }),
				text("and "),
				text("strike ", { type: "strike" }),
				text("next"),
			]),
		);

		expect(markdown).toBe("*italic* and ~~strike~~ next");
	});

	it("keeps whitespace inside inline code spans", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([text("foo ", { type: "code" }), text("bar")]),
		);

		expect(markdown).toBe("`foo `bar");
	});

	it("serializes all-whitespace bold text after content outside the closing delimiter", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([text("a", { type: "bold" }), text("   ", { type: "bold" })]),
		);

		expect(markdown).toBe("**a**   ");
	});

	it("serializes all-whitespace bold text before content outside the opening delimiter", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([text("   ", { type: "bold" }), text("a", { type: "bold" })]),
		);

		expect(markdown).toBe("   **a**");
	});

	it("keeps interior all-whitespace bold text inside delimiters", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([
				text("a", { type: "bold" }),
				text(" ", { type: "bold" }),
				text("b", { type: "bold" }),
			]),
		);

		expect(markdown).toBe("**a b**");
	});
});
