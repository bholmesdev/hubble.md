import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror.js";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown.js";

describe("image markdown conversion", () => {
	it("parses markdown image into image node", () => {
		const doc = markdownToTiptapDoc("![diagram](example.assets/abc123.png)");
		const image = doc.content?.[0];
		expect(image?.type).toBe("image");
		expect(image?.attrs).toEqual({
			src: "example.assets/abc123.png",
			alt: "diagram",
			title: undefined,
		});
	});

	it("serializes image node back to markdown image syntax", () => {
		const markdown = tiptapDocToMarkdown({
			type: "doc",
			content: [
				{
					type: "image",
					attrs: {
						src: "example.assets/abc123.png",
						alt: "diagram",
					},
				},
			],
		});
		expect(markdown).toBe("![diagram](example.assets/abc123.png)");
	});

	it("ignores markdown images with empty URLs", () => {
		const doc = markdownToTiptapDoc("before\n\n![]()\n\nafter");
		expect(doc.content?.some((node) => node.type === "image")).toBe(false);
	});

	it("keeps both the image and text that follows it", () => {
		const doc = markdownToTiptapDoc("![diagram](example.png) trailing");

		expect(doc.content).toMatchObject([
			{ type: "image", attrs: { src: "example.png", alt: "diagram" } },
			{ type: "paragraph", content: [{ type: "text", text: "trailing" }] },
		]);
	});

	it("keeps images mixed with surrounding text", () => {
		const doc = markdownToTiptapDoc("before ![diagram](example.png) after");

		expect(doc.content).toMatchObject([
			{ type: "paragraph", content: [{ type: "text", text: "before" }] },
			{ type: "image", attrs: { src: "example.png", alt: "diagram" } },
			{ type: "paragraph", content: [{ type: "text", text: "after" }] },
		]);
	});

	it("round-trips an image with trailing text without losing the image", () => {
		const doc = markdownToTiptapDoc("![diagram](example.png) trailing");
		const markdown = tiptapDocToMarkdown(doc);

		expect(markdown).toContain("![diagram](example.png)");
		expect(markdown).toContain("trailing");
	});

	it("round-trips an image-only bullet without losing the image", () => {
		const doc = markdownToTiptapDoc("- ![](example.png)");

		expect(doc.content?.[0]).toMatchObject({
			type: "bulletList",
			content: [
				{
					type: "listItem",
					content: [
						{ type: "paragraph" },
						{ type: "image", attrs: { src: "example.png", alt: "" } },
					],
				},
			],
		});
		expect(tiptapDocToMarkdown(doc)).toContain("![](example.png)");
	});

	it("round-trips text and an image in a bullet without losing either", () => {
		const doc = markdownToTiptapDoc("- before ![diagram](example.png) after");

		expect(doc.content?.[0]).toMatchObject({
			type: "bulletList",
			content: [
				{
					type: "listItem",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "before" }] },
						{
							type: "image",
							attrs: { src: "example.png", alt: "diagram" },
						},
						{ type: "paragraph", content: [{ type: "text", text: "after" }] },
					],
				},
			],
		});
		const markdown = tiptapDocToMarkdown(doc);
		expect(markdown).toContain("before");
		expect(markdown).toContain("![diagram](example.png)");
		expect(markdown).toContain("after");
	});
});
