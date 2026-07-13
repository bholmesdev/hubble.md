import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { getActiveLinkRange } from "./Link";

const schema = new Schema({
	nodes: {
		doc: { content: "paragraph+" },
		paragraph: {
			content: "text*",
			group: "block",
			parseDOM: [{ tag: "p" }],
			toDOM: () => ["p", 0],
		},
		text: { group: "inline" },
	},
	marks: {
		link: {
			attrs: { href: {} },
			inclusive: true,
			parseDOM: [{ tag: "a[href]" }],
			toDOM: () => ["a", 0],
		},
	},
});

describe("getActiveLinkRange", () => {
	it("returns a zero-width active link for stored link marks", () => {
		const doc = schema.node("doc", null, [schema.node("paragraph", null)]);
		const base = EditorState.create({
			schema,
			doc,
			selection: TextSelection.create(doc, 1),
		});
		const state = base.apply(
			base.tr.addStoredMark(
				schema.marks.link.create({ href: "https://example.com" }),
			),
		);

		expect(getActiveLinkRange(state)).toEqual({
			from: 1,
			to: 1,
			href: "https://example.com",
			kind: "url",
			target: null,
		});
	});

	it("does not merge adjacent links with different attributes", () => {
		const doc = schema.node("doc", null, [
			schema.node("paragraph", null, [
				schema.text("a", [
					schema.marks.link.create({ href: "https://a.example" }),
				]),
				schema.text("b", [
					schema.marks.link.create({ href: "https://b.example" }),
				]),
			]),
		]);
		const state = EditorState.create({
			schema,
			doc,
			selection: TextSelection.create(doc, 1),
		});

		expect(getActiveLinkRange(state)).toMatchObject({
			from: 1,
			to: 2,
			href: "https://a.example",
		});
	});
});
