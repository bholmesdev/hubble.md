import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror.js";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown.js";

describe("embed markdown conversion", () => {
	it("parses a relative html iframe into an iframe embed node", () => {
		const doc = markdownToTiptapDoc(
			'# Demo\n\n<iframe src="./kanban.html"></iframe>',
		);

		expect(doc.content?.[1]).toEqual({
			type: "embed",
			attrs: {
				kind: "iframe",
				src: "./kanban.html",
			},
		});
	});

	it("does not parse remote iframe urls as embed nodes", () => {
		const doc = markdownToTiptapDoc(
			'<iframe src="https://google.com"></iframe>',
		);

		expect(doc.content?.[0]?.type).toBe("paragraph");
		expect(doc.content?.some((node) => node.type === "embed")).toBe(false);
	});

	it("does not parse unsafe iframe url schemes as embed nodes", () => {
		const doc = markdownToTiptapDoc(
			'<iframe src="javascript:alert(1)"></iframe>',
		);

		expect(doc.content?.[0]?.type).toBe("paragraph");
		expect(doc.content?.some((node) => node.type === "embed")).toBe(false);
	});

	it("serializes an iframe embed node back to iframe syntax", () => {
		const markdown = tiptapDocToMarkdown({
			type: "doc",
			content: [
				{
					type: "embed",
					attrs: {
						kind: "iframe",
						src: "./kanban.html",
					},
				},
			],
		});

		expect(markdown).toBe('<iframe src="./kanban.html"></iframe>');
	});
});
