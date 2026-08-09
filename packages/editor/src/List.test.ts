import type { Node as PMNode } from "@tiptap/pm/model";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { continueList, emptyItemAction } from "./List.js";

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: {
			content: "text*",
			group: "block",
			parseDOM: [{ tag: "p" }],
			toDOM: () => ["p", 0],
		},
		image: {
			group: "block",
			attrs: { src: { default: "" } },
			parseDOM: [{ tag: "img" }],
			toDOM: () => ["img"],
		},
		bulletList: {
			content: "listItem+",
			group: "block",
			parseDOM: [{ tag: "ul" }],
			toDOM: () => ["ul", 0],
		},
		orderedList: {
			content: "listItem+",
			group: "block",
			parseDOM: [{ tag: "ol" }],
			toDOM: () => ["ol", 0],
		},
		listItem: {
			content: "paragraph block*",
			attrs: { checked: { default: null } },
			parseDOM: [{ tag: "li" }],
			toDOM: () => ["li", 0],
		},
		text: { group: "inline" },
	},
});

const paragraph = (text?: string) =>
	schema.node("paragraph", null, text ? schema.text(text) : undefined);

const imageItem = () => [
	paragraph(),
	schema.node("image", { src: "cat.png" }),
	paragraph(),
];

function listDoc(
	content: PMNode[],
	type: "bulletList" | "orderedList" = "bulletList",
	attrs: Record<string, unknown> = {},
) {
	return schema.node("doc", null, [
		schema.node(type, null, [schema.node("listItem", attrs, content)]),
	]);
}

// Image paste leaves the cursor in the last empty paragraph.
function selectLastParagraph(doc: PMNode) {
	let pos: number | undefined;
	doc.descendants((node, offset) => {
		if (node.type.name === "paragraph") pos = offset + 1;
	});
	if (pos === undefined) throw new Error("document has no paragraph");
	return TextSelection.create(doc, pos);
}

function applyToImageItem(
	type: "bulletList" | "orderedList" = "bulletList",
	attrs: Record<string, unknown> = {},
) {
	const doc = listDoc(imageItem(), type, attrs);
	const state = EditorState.create({
		doc,
		selection: selectLastParagraph(doc),
	});
	const tr = state.tr;
	return { handled: continueList(tr), tr };
}

describe("emptyItemAction", () => {
	it.each([
		["image item", listDoc(imageItem()), "continue"],
		["numbered image item", listDoc(imageItem(), "orderedList"), "continue"],
		[
			"task image item",
			listDoc(imageItem(), "bulletList", { checked: false }),
			"continue",
		],
		["empty item", listDoc([paragraph()]), "exit"],
		["item with text", listDoc([paragraph("hello")]), null],
		["paragraph outside a list", schema.node("doc", null, [paragraph()]), null],
	] as const)("handles %s", (_name, doc, expected) => {
		expect(emptyItemAction(selectLastParagraph(doc))).toBe(expected);
	});

	it("ignores a nonempty tail", () => {
		const doc = listDoc([
			paragraph(),
			schema.node("image", { src: "cat.png" }),
			paragraph("caption"),
		]);

		expect(emptyItemAction(selectLastParagraph(doc))).toBe(null);
	});
});

describe("continueList", () => {
	it("moves the empty tail to a new list item", () => {
		const { handled, tr } = applyToImageItem();
		const list = tr.doc.firstChild;

		expect(handled).toBe(true);
		expect(list?.childCount).toBe(2);
		expect(list?.child(0).childCount).toBe(2);
		expect(list?.child(0).lastChild?.type.name).toBe("image");
		expect(list?.child(1).childCount).toBe(1);
		expect(list?.child(1).firstChild?.type.name).toBe("paragraph");
	});

	it("puts the cursor in the new item", () => {
		const { tr } = applyToImageItem();

		expect(
			tr.selection.$from.node(tr.selection.$from.depth - 1).type.name,
		).toBe("listItem");
		expect(tr.selection.$from.parent.type.name).toBe("paragraph");
	});

	it("keeps numbered lists numbered", () => {
		const { tr } = applyToImageItem("orderedList");

		expect(tr.doc.firstChild?.type.name).toBe("orderedList");
		expect(tr.doc.firstChild?.childCount).toBe(2);
	});

	it("unchecks the next task", () => {
		const { tr } = applyToImageItem("bulletList", { checked: true });

		expect(tr.doc.firstChild?.child(0).attrs.checked).toBe(true);
		expect(tr.doc.firstChild?.child(1).attrs.checked).toBe(false);
	});
});
