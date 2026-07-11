import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown";

function textNodes(value: JSONContent) {
	const nodes: JSONContent[] = [];

	function visit(node: JSONContent) {
		if (node.type === "text") nodes.push(node);
		for (const child of node.content ?? []) visit(child);
	}

	visit(value);
	return nodes;
}

describe("CriticMarkup review conversion", () => {
	it("round-trips the portable review subset", () => {
		const markdown =
			"A {==commented range==}{>>Please revise this<<}{#c1} {++new text++}{#s1} {--old text--} {~~before~>after~~}{#s2} {==highlighted==}";

		expect(tiptapDocToMarkdown(markdownToTiptapDoc(markdown))).toBe(markdown);
	});

	it("stores review state as marks with ids and comment bodies", () => {
		const doc = markdownToTiptapDoc(
			"{==commented==}{>>A note<<}{#c7} {++inserted++} {--deleted--} {~~old~>new~~}",
		);
		const nodes = textNodes(doc);

		expect(nodes.map((node) => node.text)).toEqual([
			"commented",
			" ",
			"inserted",
			" ",
			"deleted",
			" ",
			"new",
		]);
		expect(nodes[0]?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewComment", body: "A note", id: "c7" },
		});
		expect(nodes[2]?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewInsertion", id: null },
		});
		expect(nodes[4]?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewDeletion", id: null },
		});
		expect(nodes[6]?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewReplacement", original: "old", id: null },
		});
	});

	it("does not interpret review markers inside code", () => {
		const markdown = [
			"`{==inline code==}`",
			"",
			"```md",
			"{++fenced code++}",
			"```",
		].join("\n");

		const doc = markdownToTiptapDoc(markdown);
		const nodes = textNodes(doc);

		expect(
			nodes.some((node) =>
				node.marks?.some((mark) => mark.type === "reviewMark"),
			),
		).toBe(false);
		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});
});
