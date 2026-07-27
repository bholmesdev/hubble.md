import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { findMatches, replaceFindMatches } from "./FindExtension";

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
		bold: {},
	},
});

describe("findMatches", () => {
	it("finds case-insensitive text-node matches", () => {
		const doc = schema.node("doc", null, [
			schema.node("paragraph", null, schema.text("Alpha beta alpha")),
			schema.node("paragraph", null, schema.text("Alphabet")),
		]);

		expect(findMatches(doc, "alpha")).toEqual([
			{ from: 1, to: 6 },
			{ from: 12, to: 17 },
			{ from: 19, to: 24 },
		]);
	});

	it("finds matches split across inline formatting", () => {
		const bold = schema.mark("bold");
		const doc = schema.node("doc", null, [
			schema.node("paragraph", null, [
				schema.text("needle", [bold]),
				schema.text(" top"),
			]),
		]);

		expect(findMatches(doc, "needle top")).toEqual([{ from: 1, to: 11 }]);
	});

	it("does not match across paragraph boundaries", () => {
		const doc = schema.node("doc", null, [
			schema.node("paragraph", null, schema.text("needle")),
			schema.node("paragraph", null, schema.text("top")),
		]);

		expect(findMatches(doc, "needle top")).toEqual([]);
	});

	it("returns no matches for an empty query", () => {
		const doc = schema.node("doc", null, [
			schema.node("paragraph", null, schema.text("Alpha")),
		]);

		expect(findMatches(doc, "")).toEqual([]);
	});
});

describe("replacement commands", () => {
	it("replaces one match", () => {
		const state = createState("Alpha beta alpha alpha");
		const matches = findMatches(state.doc, "alpha");
		const tr = replaceFindMatches(state.tr, [matches[1]], "gamma");

		expect(tr.doc.textContent).toBe("Alpha beta gamma alpha");
		expect(findMatches(tr.doc, "alpha")).toEqual([
			{ from: 1, to: 6 },
			{ from: 18, to: 23 },
		]);
	});

	it("replaces every match in one transaction", () => {
		const state = createState("Alpha beta alpha");
		const matches = findMatches(state.doc, "alpha");
		const tr = replaceFindMatches(state.tr, matches, "gamma");

		expect(tr.doc.textContent).toBe("gamma beta gamma");
		expect(findMatches(tr.doc, "alpha")).toEqual([]);
	});
});

function createState(content: string) {
	return EditorState.create({
		doc: schema.node("doc", null, [
			schema.node("paragraph", null, schema.text(content)),
		]),
	});
}
