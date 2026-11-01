import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror.js";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown.js";

function roundTrip(markdown: string) {
	return tiptapDocToMarkdown(markdownToTiptapDoc(markdown));
}

function collect(node: JSONContent, type: string): JSONContent[] {
	const found = node.type === type ? [node] : [];
	return found.concat(
		(node.content ?? []).flatMap((child) => collect(child, type)),
	);
}

describe("reference link markdown conversion", () => {
	it("keeps a full reference link as an inline link", () => {
		expect(roundTrip("[Hubble][site]\n\n[site]: https://hubble.md\n")).toBe(
			"[Hubble](https://hubble.md)",
		);
	});

	it("keeps collapsed and shortcut references", () => {
		expect(roundTrip("[site][]\n\n[site]: https://hubble.md\n")).toBe(
			"[site](https://hubble.md)",
		);
		expect(roundTrip("[site]\n\n[site]: https://hubble.md\n")).toBe(
			"[site](https://hubble.md)",
		);
	});

	it("matches labels case-insensitively", () => {
		expect(roundTrip("[x][SITE]\n\n[site]: https://hubble.md\n")).toBe(
			"[x](https://hubble.md)",
		);
	});

	it("keeps the link when the definition has a title", () => {
		const doc = markdownToTiptapDoc(
			'[Hubble][site]\n\n[site]: https://hubble.md "A \\"quoted\\" title"\n',
		);
		const text = collect(doc, "text")[0];
		expect(text?.marks?.[0]?.attrs?.href).toBe("https://hubble.md");
	});

	it("uses the first definition when labels are duplicated", () => {
		expect(
			roundTrip("[a][x]\n\n[x]: https://one.com\n[x]: https://two.com\n"),
		).toBe("[a](https://one.com)");
	});

	it("keeps text around a reference link", () => {
		expect(
			roundTrip("before [Hubble][site] after\n\n[site]: https://hubble.md\n"),
		).toBe("before [Hubble](https://hubble.md) after");
	});

	it("handles definitions with angle brackets", () => {
		const doc = markdownToTiptapDoc("[a][x]\n\n[x]: <https://e.com/a>\n");
		expect(collect(doc, "text")[0]?.marks?.[0]?.attrs?.href).toBe(
			"https://e.com/a",
		);
	});

	it("keeps reference images at top level", () => {
		const doc = markdownToTiptapDoc("![alt][img]\n\n[img]: ./a.png\n");
		expect(collect(doc, "image")[0]?.attrs).toMatchObject({
			src: "./a.png",
			alt: "alt",
		});
		expect(roundTrip("![alt][img]\n\n[img]: ./a.png\n")).toBe(
			"![alt](./a.png)",
		);
	});

	it("keeps a reference image alone in a list item", () => {
		const doc = markdownToTiptapDoc("- ![alt][img]\n\n[img]: ./a.png\n");
		expect(collect(doc, "image")).toHaveLength(1);
	});

	it("keeps a reference image in a table cell", () => {
		const doc = markdownToTiptapDoc(
			"| a |\n| - |\n| ![alt][img] |\n\n[img]: ./a.png\n",
		);
		expect(collect(doc, "image")).toHaveLength(1);
	});

	it("handles definitions inside blockquotes and list items", () => {
		const quote = markdownToTiptapDoc("> [a][x]\n>\n> [x]: https://e.com\n");
		expect(collect(quote, "text")[0]?.marks?.[0]?.attrs?.href).toBe(
			"https://e.com",
		);
		expect(roundTrip("> [a][x]\n>\n> [x]: https://e.com\n")).toBe(
			"> [a](https://e.com)",
		);
		const list = markdownToTiptapDoc("- [a][x]\n\n  [x]: https://e.com\n- b\n");
		const items = collect(list, "listItem");
		expect(items).toHaveLength(2);
		expect(items.every((item) => (item.content ?? []).length > 0)).toBe(true);
	});

	it("keeps an undefined reference as literal text", () => {
		expect(roundTrip("[foo][bar]")).toBe("[foo][bar]");
	});
});
