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

	it("round-trips inline thread metadata without rendering it", () => {
		const markdown =
			"{==commented==}{>>A note<<}{#c7}<!-- hubble-review:%7B%22source%22%3A%22agent%22%2C%22replies%22%3A%5B%7B%22id%22%3A%22r1%22%2C%22body%22%3A%22Reply%22%7D%5D%2C%22resolved%22%3Atrue%7D-->";
		const doc = markdownToTiptapDoc(markdown);
		const node = textNodes(doc)[0];

		expect(node?.marks).toContainEqual({
			type: "reviewMark",
			attrs: {
				type: "reviewComment",
				body: "A note",
				id: "c7",
				replies: [{ id: "r1", body: "Reply" }],
				resolved: true,
				metadata: {
					source: "agent",
					replies: [{ id: "r1", body: "Reply" }],
					resolved: true,
				},
			},
		});
		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("round-trips comments around formatted text", () => {
		const markdown = "Use {==**bold text**==}{>>A note<<}{#c1}";
		const doc = markdownToTiptapDoc(markdown);
		const node = textNodes(doc).find(
			(candidate) => candidate.text === "bold text",
		);

		expect(node?.text).toBe("bold text");
		expect(node?.marks).toContainEqual({ type: "bold" });
		expect(node?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewComment", body: "A note", id: "c1" },
		});
		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});
});
