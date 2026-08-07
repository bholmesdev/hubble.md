import type { Node as PMNode } from "@tiptap/pm/model";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { continueListItem } from "./List.js";
import {
	isAtEndOfListItemWithContent,
	isInEmptyListItem,
	isSelectionAtStartOfNode,
} from "./utils.js";

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
			inline: false,
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

/**
 * Place a collapsed cursor at the start of the last paragraph in the document.
 * That is where an image paste leaves the cursor: in the empty paragraph the
 * paste inserts after the image.
 */
function cursorAtLastParagraphStart(doc: PMNode): TextSelection {
	let pos: number | null = null;
	doc.descendants((node, offset) => {
		if (node.type.name === "paragraph") pos = offset + 1;
		return true;
	});
	if (pos === null) throw new Error("document has no paragraph");
	return TextSelection.create(doc, pos);
}

function listDoc(
	listType: "bulletList" | "orderedList",
	itemContent: PMNode[],
	itemAttrs: Record<string, unknown> = {},
) {
	return schema.node("doc", null, [
		schema.node(listType, null, [
			schema.node("listItem", itemAttrs, itemContent),
		]),
	]);
}

const emptyParagraph = () => schema.node("paragraph");

/**
 * A list item as an image paste leaves it. `listItem` content is
 * `paragraph block*`, so the image cannot lead: pasting splits the original
 * paragraph and inserts the image plus a trailing paragraph after it.
 */
const imageItemContent = () => [
	emptyParagraph(),
	schema.node("image", { src: "cat.png" }),
	emptyParagraph(),
];

describe("isInEmptyListItem", () => {
	it("is false for an item holding an image, so Enter keeps the list", () => {
		const doc = listDoc("bulletList", imageItemContent());

		expect(isInEmptyListItem(cursorAtLastParagraphStart(doc))).toBe(false);
	});

	it("is true for a genuinely empty item, so Enter still exits the list", () => {
		const doc = listDoc("bulletList", [emptyParagraph()]);

		expect(isInEmptyListItem(cursorAtLastParagraphStart(doc))).toBe(true);
	});

	it("is false for an item holding an image in a numbered list", () => {
		const doc = listDoc("orderedList", imageItemContent());

		expect(isInEmptyListItem(cursorAtLastParagraphStart(doc))).toBe(false);
	});

	it("is false for an item holding an image in a task list", () => {
		const doc = listDoc("bulletList", imageItemContent(), {
			checked: false,
		});

		expect(isInEmptyListItem(cursorAtLastParagraphStart(doc))).toBe(false);
	});

	it("is false when the cursor sits at the start of item text", () => {
		const doc = listDoc("bulletList", [
			schema.node("paragraph", null, schema.text("hello")),
		]);

		expect(isInEmptyListItem(cursorAtLastParagraphStart(doc))).toBe(false);
	});

	it("is false outside of any list", () => {
		const doc = schema.node("doc", null, [emptyParagraph()]);

		expect(isInEmptyListItem(cursorAtLastParagraphStart(doc))).toBe(false);
	});
});

describe("isAtEndOfListItemWithContent", () => {
	it("is true in the empty paragraph trailing an image, so Enter continues the list", () => {
		const doc = listDoc("bulletList", imageItemContent());

		expect(isAtEndOfListItemWithContent(cursorAtLastParagraphStart(doc))).toBe(
			true,
		);
	});

	it("is true for the same item in a numbered list", () => {
		const doc = listDoc("orderedList", imageItemContent());

		expect(isAtEndOfListItemWithContent(cursorAtLastParagraphStart(doc))).toBe(
			true,
		);
	});

	it("is true for the same item in a task list", () => {
		const doc = listDoc("bulletList", imageItemContent(), { checked: false });

		expect(isAtEndOfListItemWithContent(cursorAtLastParagraphStart(doc))).toBe(
			true,
		);
	});

	it("is false for a genuinely empty item, which should still exit the list", () => {
		const doc = listDoc("bulletList", [emptyParagraph()]);

		expect(isAtEndOfListItemWithContent(cursorAtLastParagraphStart(doc))).toBe(
			false,
		);
	});

	it("is false when the trailing paragraph has text", () => {
		const doc = listDoc("bulletList", [
			emptyParagraph(),
			schema.node("image", { src: "cat.png" }),
			schema.node("paragraph", null, schema.text("caption")),
		]);

		expect(isAtEndOfListItemWithContent(cursorAtLastParagraphStart(doc))).toBe(
			false,
		);
	});

	it("is false outside of any list", () => {
		const doc = schema.node("doc", null, [emptyParagraph()]);

		expect(isAtEndOfListItemWithContent(cursorAtLastParagraphStart(doc))).toBe(
			false,
		);
	});
});

describe("Enter guard in list items", () => {
	// Regression cover for #237: the start-of-node check alone reports true for
	// an image item, because the cursor sits in the empty paragraph the paste
	// leaves behind. Lifting on that check alone dropped the image out of the
	// list, so the guard needs both conditions.
	it("start-of-node alone is not enough to lift an image item", () => {
		const doc = listDoc("bulletList", imageItemContent());
		const selection = cursorAtLastParagraphStart(doc);

		expect(isSelectionAtStartOfNode(selection)).toBe(true);
		expect(
			isSelectionAtStartOfNode(selection) && isInEmptyListItem(selection),
		).toBe(false);
	});
});

describe("continueListItem", () => {
	function applyToImageItem(
		listType: "bulletList" | "orderedList" = "bulletList",
		itemAttrs: Record<string, unknown> = {},
	) {
		const doc = listDoc(listType, imageItemContent(), itemAttrs);
		const state = EditorState.create({
			doc,
			selection: cursorAtLastParagraphStart(doc),
		});
		const tr = state.tr;
		const handled = continueListItem(tr);
		return { handled, doc: tr.doc, selection: tr.selection };
	}

	it("replaces the trailing paragraph with a sibling list item", () => {
		const { handled, doc } = applyToImageItem();
		const list = doc.firstChild;

		expect(handled).toBe(true);
		expect(list?.childCount).toBe(2);
		// The image stays put, and its item no longer carries the empty paragraph.
		expect(list?.child(0).childCount).toBe(2);
		expect(list?.child(0).child(1).type.name).toBe("image");
		// The new item is an empty list item ready to type into.
		expect(list?.child(1).childCount).toBe(1);
		expect(list?.child(1).firstChild?.type.name).toBe("paragraph");
		expect(list?.child(1).textContent).toBe("");
	});

	it("leaves the cursor inside the new list item", () => {
		const { doc, selection } = applyToImageItem();
		const list = doc.firstChild;
		const newItemStart = 1 + (list?.child(0).nodeSize ?? 0);

		expect(selection.from).toBeGreaterThan(newItemStart);
		expect(selection.$from.node(selection.$from.depth - 1).type.name).toBe(
			"listItem",
		);
		expect(selection.$from.parent.type.name).toBe("paragraph");
	});

	it("keeps the list type when continuing a numbered list", () => {
		const { doc } = applyToImageItem("orderedList");

		expect(doc.firstChild?.type.name).toBe("orderedList");
		expect(doc.firstChild?.childCount).toBe(2);
	});

	it("starts the next task item unchecked", () => {
		const { doc } = applyToImageItem("bulletList", { checked: true });

		expect(doc.firstChild?.child(0).attrs.checked).toBe(true);
		expect(doc.firstChild?.child(1).attrs.checked).toBe(false);
	});
});
