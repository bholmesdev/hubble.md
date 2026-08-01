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

describe("inline mark nesting markdown conversion", () => {
	it.each([
		["bold", "italic", "**this *text* works**"],
		["bold", "strike", "**this ~~text~~ works**"],
		["italic", "strike", "*this ~~text~~ works*"],
	])("keeps boundary whitespace outside nested %s and %s delimiters", (outer, inner, expected) => {
		const markdown = tiptapDocToMarkdown(
			paragraph([
				text("this", { type: outer }),
				text(" text ", { type: outer }, { type: inner }),
				text("works", { type: outer }),
			]),
		);

		expect(markdown).toBe(expected);
	});

	it("keeps boundary whitespace outside triple nested delimiters", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([
				text("this", { type: "bold" }, { type: "italic" }),
				text(
					" text ",
					{ type: "bold" },
					{ type: "italic" },
					{ type: "strike" },
				),
				text("works", { type: "bold" }, { type: "italic" }),
			]),
		);

		expect(markdown).toBe("***this ~~text~~ works***");
	});

	it("keeps boundary whitespace on the shared mark across a group transition", () => {
		const markdown = tiptapDocToMarkdown(
			paragraph([
				text("this", { type: "bold" }),
				text(" is italic ", { type: "italic" }, { type: "strike" }),
				text("text.", { type: "strike" }),
			]),
		);

		expect(markdown).toBe("**this** ~~*is italic* text.~~");
	});

	const wikiLink: Mark = {
		type: "link",
		attrs: { href: "target", kind: "wiki", target: "target" },
	};
	const regularLink: Mark = {
		type: "link",
		attrs: { href: "https://example.com" },
	};

	it.each([
		["wiki", "bold", wikiLink, "**this [[target|alias]] text**"],
		["wiki", "italic", wikiLink, "*this [[target|alias]] text*"],
		["wiki", "strike", wikiLink, "~~this [[target|alias]] text~~"],
		[
			"regular",
			"bold",
			regularLink,
			"**this [alias](https://example.com) text**",
		],
		[
			"regular",
			"italic",
			regularLink,
			"*this [alias](https://example.com) text*",
		],
		[
			"regular",
			"strike",
			regularLink,
			"~~this [alias](https://example.com) text~~",
		],
	])("keeps %s link boundary whitespace outside %s delimiters", (_kind, markType, link, expected) => {
		const markdown = tiptapDocToMarkdown(
			paragraph([
				text("this", { type: markType }),
				text(" alias ", { type: markType }, link),
				text("text", { type: markType }),
			]),
		);

		expect(markdown).toBe(expected);
	});
});
