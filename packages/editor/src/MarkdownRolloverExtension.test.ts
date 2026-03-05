import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
	__testing,
	getCaretFormattingState,
} from "./MarkdownRolloverExtension";

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
		bold: { parseDOM: [{ tag: "strong" }], toDOM: () => ["strong", 0] },
		italic: { parseDOM: [{ tag: "em" }], toDOM: () => ["em", 0] },
		code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
		strike: {
			parseDOM: [{ tag: "s" }, { tag: "del" }],
			toDOM: () => ["s", 0],
		},
		link: {
			attrs: { href: {} },
			inclusive: true,
			parseDOM: [{ tag: "a[href]" }],
			toDOM: () => ["a", 0],
		},
	},
});

function buildDoc() {
	const bold = schema.marks.bold.create();
	const link = schema.marks.link.create({ href: "https://example.com" });
	return schema.node("doc", null, [
		schema.node("paragraph", null, [
			schema.text("This is "),
			schema.text("bolded text", [bold]),
			schema.text(" done"),
			schema.text(" and "),
			schema.text("linked", [link]),
			schema.text(" tail"),
		]),
	]);
}

function stateAt(pos: number) {
	const doc = buildDoc();
	return EditorState.create({
		schema,
		doc,
		selection: TextSelection.create(doc, pos),
	});
}

function getMarkRange(state: EditorState, markName: string) {
	let from: number | null = null;
	let to: number | null = null;
	state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
		if (!node.isText) return;
		const hasMark = node.marks.some((mark) => mark.type.name === markName);
		if (!hasMark) return;
		if (from == null) from = pos;
		to = pos + node.nodeSize;
	});
	if (from == null || to == null) {
		throw new Error(`mark range missing: ${markName}`);
	}
	return { from, to };
}

const range = getMarkRange(stateAt(2), "bold");
const BOLD_START = range.from;
const BOLD_END = range.to;
const linkRange = getMarkRange(stateAt(2), "link");
const LINK_START = linkRange.from;
const LINK_END = linkRange.to;

describe("markdown rollover esc-only behavior", () => {
	it("can escape at bold boundary when bold mark is active for insertion", () => {
		const base = stateAt(BOLD_END);
		const state = base.apply(base.tr.addStoredMark(schema.marks.bold.create()));
		expect(__testing.canEscapeBoundaryAtCursor(state, null)).toBe(true);
	});

	it("cannot escape at bold boundary when bold mark is not active", () => {
		const state = stateAt(BOLD_END + 1);
		expect(__testing.canEscapeBoundaryAtCursor(state, null)).toBe(false);
	});

	it("reports active caret marks from stored marks", () => {
		const base = stateAt(BOLD_END + 1);
		const withStored = base.apply(
			base.tr.addStoredMark(schema.marks.italic.create()),
		);
		expect(getCaretFormattingState(withStored).activeMarkNames).toEqual([
			"italic",
		]);
	});

	it("reports canEscapeBoundary false for non-empty selections", () => {
		const doc = buildDoc();
		const state = EditorState.create({
			schema,
			doc,
			selection: TextSelection.create(doc, BOLD_START, BOLD_END),
		});
		expect(getCaretFormattingState(state).canEscapeBoundary).toBe(false);
	});

	it("treats only link end edge as active formatting by default", () => {
		const atStart = getCaretFormattingState(stateAt(LINK_START));
		const atEnd = getCaretFormattingState(stateAt(LINK_END));
		expect(atStart.activeMarkNames).not.toContain("link");
		expect(atEnd.activeMarkNames).toContain("link");
		expect(atStart.canEscapeBoundary).toBe(false);
		expect(atEnd.canEscapeBoundary).toBe(true);
	});
});

describe("escape stored marks on empty line", () => {
	function emptyLineState() {
		const doc = schema.node("doc", null, [schema.node("paragraph", null, [])]);
		return EditorState.create({
			schema,
			doc,
			selection: TextSelection.create(doc, 1),
		});
	}

	it("can escape when stored formatting marks exist on empty line", () => {
		const base = emptyLineState();
		const state = base.apply(base.tr.addStoredMark(schema.marks.bold.create()));
		expect(__testing.canEscapeBoundaryAtCursor(state, null)).toBe(true);
	});

	it("cannot escape when no stored marks on empty line", () => {
		const state = emptyLineState();
		expect(__testing.canEscapeBoundaryAtCursor(state, null)).toBe(false);
	});

	it("reports canEscapeBoundary true via getCaretFormattingState", () => {
		const base = emptyLineState();
		const state = base.apply(base.tr.addStoredMark(schema.marks.bold.create()));
		const formatting = getCaretFormattingState(state);
		expect(formatting.canEscapeBoundary).toBe(true);
		expect(formatting.activeMarkNames).toContain("bold");
	});

	it("detects multiple stored formatting marks", () => {
		const base = emptyLineState();
		const state = base.apply(
			base.tr
				.addStoredMark(schema.marks.bold.create())
				.addStoredMark(schema.marks.italic.create()),
		);
		expect(__testing.hasStoredFormattingMarks(state)).toBe(true);
		expect(__testing.canEscapeBoundaryAtCursor(state, null)).toBe(true);
	});
});
