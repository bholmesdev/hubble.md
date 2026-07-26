import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown";
import { parseReviewMetadata, serializeReviewMetadata } from "./ReviewMark";

function textNodes(value: JSONContent) {
	const nodes: JSONContent[] = [];

	function visit(node: JSONContent) {
		if (node.type === "text") nodes.push(node);
		for (const child of node.content ?? []) visit(child);
	}

	visit(value);
	return nodes;
}

function docWithReviewMark(
	text: string,
	attrs: Record<string, unknown>,
): JSONContent {
	const doc = markdownToTiptapDoc(text);
	const node = textNodes(doc)[0];
	if (!node) throw new Error("Expected text node");
	node.marks = [{ type: "reviewMark", attrs }];
	return doc;
}

function reviewMark(doc: JSONContent) {
	return textNodes(doc)
		.flatMap((node) => node.marks ?? [])
		.find((mark) => mark.type === "reviewMark");
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
			'{==commented==}{>>A note<<}{#c7}<!-- hubble-review:{"source":"agent","v":1,"replies":[{"id":"r1","body":"Reply"}],"resolved":true}-->';
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
					v: 1,
					replies: [{ id: "r1", body: "Reply" }],
					resolved: true,
				},
			},
		});
		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("preserves unknown metadata fields on an unresolved comment with no replies", () => {
		const markdown =
			'{==commented==}{>>A note<<}{#c9}<!-- hubble-review:{"source":"agent","v":1,"replies":[],"resolved":false}-->';
		const doc = markdownToTiptapDoc(markdown);

		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("escapes comment terminators in reply bodies losslessly", () => {
		const body = "Wait -- this contains --> safely";
		const serialized = serializeReviewMetadata({
			type: "reviewComment",
			replies: [{ id: "r1", body }],
		});
		const payload = serialized.slice("<!-- hubble-review:".length, -3);

		expect(payload).not.toContain("-->");
		expect(payload).not.toContain("--");
		expect(JSON.parse(payload)).toMatchObject({ v: 1 });
		expect(parseReviewMetadata(serialized)?.replies).toEqual([
			{ id: "r1", body },
		]);
	});

	it("parses legacy percent-encoded thread metadata", () => {
		const legacy =
			"<!-- hubble-review:%7B%22replies%22%3A%5B%7B%22id%22%3A%22r1%22%2C%22body%22%3A%22Reply%22%7D%5D%2C%22resolved%22%3Atrue%7D-->";

		expect(parseReviewMetadata(legacy)).toMatchObject({
			replies: [{ id: "r1", body: "Reply" }],
			resolved: true,
		});
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

	it("escapes CriticMarkup delimiters in comment bodies losslessly", () => {
		const body = String.raw`Keep <<} {>> {== ==} {++ ++} {-- --} {~~ ~> ~~} {#id} and \\<<} exact`;
		const doc = markdownToTiptapDoc("Commented text");
		const text = textNodes(doc)[0];
		if (!text) throw new Error("Expected text node");
		text.marks = [
			{
				type: "reviewMark",
				attrs: { type: "reviewComment", body, id: "c1" },
			},
		];

		const serialized = tiptapDocToMarkdown(doc);
		const reparsed = markdownToTiptapDoc(serialized);
		const mark = textNodes(reparsed)[0]?.marks?.find(
			(candidate) => candidate.type === "reviewMark",
		);

		expect(mark?.attrs?.body).toBe(body);
		expect(tiptapDocToMarkdown(reparsed)).toBe(serialized);
	});

	it.each([
		[{ type: "reviewHighlight", id: "s1" }, "has ==} inside"],
		[{ type: "reviewInsertion", id: "s1" }, "has ++} inside"],
		[{ type: "reviewDeletion", id: "s1" }, "has --} inside"],
		[
			{ type: "reviewComment", body: "note", id: "c1" },
			"anchor with ==} inside",
		],
	])("keeps a $type span whose text carries its own closer", (attrs, content) => {
		const doc = docWithReviewMark(content, attrs);

		const serialized = tiptapDocToMarkdown(doc);
		const reparsed = markdownToTiptapDoc(serialized);

		expect(
			textNodes(reparsed)
				.map((node) => node.text)
				.join(""),
		).toBe(content);
		expect(reviewMark(reparsed)?.attrs).toMatchObject(attrs);
		expect(tiptapDocToMarkdown(reparsed)).toBe(serialized);
	});

	it.each([
		"Use *this* instead",
		"rename `foo` to `bar`",
		"see [docs](x)",
		"line1\n\nline2",
		"2 * 3 = 6",
		"a<b",
		"  padded  ",
		"newline\nsecond line",
	])("round-trips Markdown-active comment body %j", (body) => {
		const doc = docWithReviewMark("Commented text here", {
			type: "reviewComment",
			body,
			id: "c1",
		});

		const serialized = tiptapDocToMarkdown(doc);
		const reparsed = markdownToTiptapDoc(serialized);

		expect(
			textNodes(reparsed)
				.map((node) => node.text)
				.join(""),
		).toBe("Commented text here");
		expect(reviewMark(reparsed)?.attrs).toMatchObject({
			type: "reviewComment",
			body,
			id: "c1",
		});
		expect(tiptapDocToMarkdown(reparsed)).toBe(serialized);
	});

	it.each([
		"a~>b",
		"a~~}b",
	])("round-trips replacement original %j", (original) => {
		const doc = docWithReviewMark("newtext", {
			type: "reviewReplacement",
			original,
			id: "s1",
		});

		const serialized = tiptapDocToMarkdown(doc);
		const reparsed = markdownToTiptapDoc(serialized);

		expect(
			textNodes(reparsed)
				.map((node) => node.text)
				.join(""),
		).toBe("newtext");
		expect(reviewMark(reparsed)?.attrs).toMatchObject({
			type: "reviewReplacement",
			original,
			id: "s1",
		});
		expect(tiptapDocToMarkdown(reparsed)).toBe(serialized);
	});

	it("round-trips a comment whose opener follows prose before formatted text", () => {
		const markdown = "Before {==plain **bold** tail==}{>>note<<}{#c1}";
		const doc = markdownToTiptapDoc(markdown);
		const nodes = textNodes(doc);

		expect(nodes.some((node) => node.text?.includes("{=="))).toBe(false);
		const boldNode = nodes.find((node) => node.text === "bold");
		expect(boldNode?.marks).toContainEqual({ type: "bold" });
		expect(boldNode?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewComment", body: "note", id: "c1" },
		});
		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("round-trips two adjacent formatted comment spans", () => {
		const markdown = "{==**one**==}{>>a<<}{#c1} {==**two**==}{>>b<<}{#c2}";
		const doc = markdownToTiptapDoc(markdown);
		const nodes = textNodes(doc);

		expect(nodes.some((node) => node.text?.includes("{=="))).toBe(false);
		expect(nodes.some((node) => node.text?.includes("==}"))).toBe(false);

		const oneNode = nodes.find((node) => node.text === "one");
		expect(oneNode?.marks).toContainEqual({ type: "bold" });
		expect(oneNode?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewComment", body: "a", id: "c1" },
		});
		const twoNode = nodes.find((node) => node.text === "two");
		expect(twoNode?.marks).toContainEqual({ type: "bold" });
		expect(twoNode?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewComment", body: "b", id: "c2" },
		});

		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("recovers a formatted replacement's new text and marks", () => {
		const markdown = "{~~old~>**new**~~}{#s1}";
		const doc = markdownToTiptapDoc(markdown);
		const nodes = textNodes(doc);

		expect(nodes.some((node) => node.text?.includes("{~~"))).toBe(false);
		const newNode = nodes.find((node) => node.text === "new");
		expect(newNode?.marks).toContainEqual({ type: "bold" });
		expect(newNode?.marks).toContainEqual({
			type: "reviewMark",
			attrs: { type: "reviewReplacement", original: "old", id: "s1" },
		});

		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("recovers formatted replacement original text", () => {
		const markdown = "{~~**old**~>new~~}{#s1}";
		const doc = markdownToTiptapDoc(markdown);
		const node = textNodes(doc).find((candidate) => candidate.text === "new");

		expect(node?.marks).toContainEqual({
			type: "reviewMark",
			attrs: {
				type: "reviewReplacement",
				original: "**old**",
				id: "s1",
			},
		});
		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("round-trips one comment across code and wiki-link inline marks", () => {
		const body =
			"Open `file-index.html` or `todo-demo.html` from the sidebar to try full-screen HTML Apps. See [[samples/interview-prep]] for prompts.";
		const doc = markdownToTiptapDoc(body);
		const reviewMark = {
			type: "reviewMark",
			attrs: { type: "reviewComment", body: "A note", id: "c1" },
		};
		const paragraph = doc.content?.[0];

		if (!paragraph?.content) throw new Error("Expected paragraph content");
		paragraph.content = paragraph.content.map((node) =>
			node.type === "text"
				? { ...node, marks: [...(node.marks ?? []), reviewMark] }
				: node,
		);

		expect(tiptapDocToMarkdown(doc)).toBe(`{==${body}==}{>>A note<<}{#c1}`);
	});

	it("applies thread metadata to every segment of a split comment span", () => {
		const markdown =
			'{==Frontmatter linter with `yaml` validation==}{>>should add toml too<<}{#c4}<!-- hubble-review:{"v":1,"replies":[],"resolved":true}-->';
		const doc = markdownToTiptapDoc(markdown);
		const segments = textNodes(doc)
			.map((node) =>
				node.marks?.find(
					(mark) =>
						mark.type === "reviewMark" && mark.attrs?.type === "reviewComment",
				),
			)
			.filter((mark) => mark !== undefined);

		expect(segments.length).toBeGreaterThan(1);
		for (const mark of segments) {
			expect(mark?.attrs?.resolved).toBe(true);
		}
		expect(tiptapDocToMarkdown(doc)).toBe(markdown);
	});

	it("re-unifies adjacent same-id comment spans on round-trip", () => {
		// Older serializations could split one comment into adjacent spans with
		// the metadata trailing only the last one.
		const markdown =
			"{==A `code`==}{>>note<<}{#c4}{== B==}{>>note<<}{#c4}<!-- hubble-review:%7B%22replies%22%3A%5B%5D%2C%22resolved%22%3Atrue%7D-->";
		const doc = markdownToTiptapDoc(markdown);

		expect(tiptapDocToMarkdown(doc)).toBe(
			'{==A `code` B==}{>>note<<}{#c4}<!-- hubble-review:{"replies":[],"resolved":true,"v":1}-->',
		);
	});

	it("loads comment metadata without exposing CriticMarkup as text", () => {
		const markdown =
			'{==Open `file-index.html` or `todo-demo.html` from the sidebar to try full-screen HTML Apps. See [[samples/interview-prep]] for prompts.==}{>>A note<<}{#c1}<!-- hubble-review:{"v":1,"replies":[],"resolved":false}-->';
		const doc = markdownToTiptapDoc(markdown);
		const nodes = textNodes(doc);

		expect(nodes.some((node) => node.text?.includes("{=="))).toBe(false);
		expect(
			nodes
				.filter((node) =>
					node.marks?.some(
						(mark) =>
							mark.type === "reviewMark" &&
							mark.attrs?.type === "reviewComment",
					),
				)
				.map((node) => node.text),
		).toEqual([
			"Open ",
			"file-index.html",
			" or ",
			"todo-demo.html",
			" from the sidebar to try full-screen HTML Apps. See ",
			"interview-prep",
			" for prompts.",
		]);
	});
});
