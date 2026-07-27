import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type FindMatch = {
	from: number;
	to: number;
};

export type FindState = {
	query: string;
	activeIndex: number;
	matches: FindMatch[];
};

type FindMeta =
	| { type: "setQuery"; query: string }
	| { type: "setActiveIndex"; activeIndex: number }
	| { type: "clear" };
type TextOffset = {
	docPos: number | null;
};
type TextIndex = {
	offsets: TextOffset[];
	text: string;
};

export const findPluginKey = new PluginKey<FindState>("hubbleFind");

export const FindExtension = Extension.create({
	name: "find",

	addCommands() {
		return {
			setFindQuery:
				(query: string) =>
				({ state, dispatch }) => {
					if (!dispatch) return true;
					dispatch(
						state.tr.setMeta(findPluginKey, { type: "setQuery", query }),
					);
					return true;
				},
			setFindActiveIndex:
				(activeIndex: number) =>
				({ state, dispatch }) => {
					if (!dispatch) return true;
					dispatch(
						state.tr.setMeta(findPluginKey, {
							type: "setActiveIndex",
							activeIndex,
						}),
					);
					return true;
				},
			replaceFindMatch:
				(replacement: string) =>
				({ state, dispatch }) => {
					const findState = getFindState(state);
					const match = findState.matches[findState.activeIndex];
					if (!match) return false;
					if (!dispatch) return true;
					const tr = replaceFindMatches(state.tr, [match], replacement);
					const matches = findMatches(tr.doc, findState.query);
					const replacementEnd = match.from + replacement.length;
					const activeIndex = Math.max(
						0,
						matches.findIndex((candidate) => candidate.from >= replacementEnd),
					);
					dispatch(
						tr.setMeta(findPluginKey, {
							type: "setActiveIndex",
							activeIndex,
						}),
					);
					return true;
				},
			replaceAllFindMatches:
				(replacement: string) =>
				({ state, dispatch }) => {
					const findState = getFindState(state);
					if (findState.matches.length === 0) return false;
					if (!dispatch) return true;
					dispatch(
						replaceFindMatches(state.tr, findState.matches, replacement),
					);
					return true;
				},
			clearFindQuery:
				() =>
				({ state, dispatch }) => {
					if (!dispatch) return true;
					dispatch(state.tr.setMeta(findPluginKey, { type: "clear" }));
					return true;
				},
		};
	},

	addProseMirrorPlugins() {
		return [
			new Plugin<FindState>({
				key: findPluginKey,
				state: {
					init: () => emptyFindState(),
					apply: (tr, previous, _oldState, newState) => {
						const meta = tr.getMeta(findPluginKey) as FindMeta | undefined;
						if (meta?.type === "clear") return emptyFindState();
						const query =
							meta?.type === "setQuery" ? meta.query : previous.query;
						const matches = query.trim()
							? findMatches(newState.doc, query)
							: [];
						const activeIndex =
							meta?.type === "setActiveIndex"
								? normalizeActiveIndex(meta.activeIndex, matches.length)
								: reconcileActiveIndex(previous.activeIndex, matches.length);
						return { query, activeIndex, matches };
					},
				},
				props: {
					decorations: (state) => {
						const findState = findPluginKey.getState(state);
						if (!findState || findState.matches.length === 0) {
							return DecorationSet.empty;
						}
						return DecorationSet.create(
							state.doc,
							findState.matches.map((match, index) =>
								Decoration.inline(match.from, match.to, {
									class:
										index === findState.activeIndex
											? "pm-find-match pm-find-match-current"
											: "pm-find-match",
								}),
							),
						);
					},
				},
			}),
		];
	},
});

export function getFindState(state: EditorState) {
	return findPluginKey.getState(state) ?? emptyFindState();
}
export function replaceFindMatches(
	tr: Transaction,
	matches: FindMatch[],
	replacement: string,
) {
	for (const match of [...matches].reverse()) {
		tr.insertText(replacement, match.from, match.to);
	}
	return tr;
}

export function selectFindMatch(editor: {
	state: EditorState;
	view: {
		coordsAtPos: (pos: number) => { top: number; bottom: number };
		dispatch: (tr: Transaction) => void;
		dom: HTMLElement;
	};
}) {
	const findState = getFindState(editor.state);
	const match = findState.matches[findState.activeIndex];
	if (!match) return false;
	const tr = editor.state.tr.setSelection(
		TextSelection.create(editor.state.doc, match.from, match.to),
	);
	editor.view.dispatch(tr);
	scrollMatchIntoView(editor.view, match.from);
	return true;
}

/**
 * Finds query matches in the document's visible text.
 *
 * ProseMirror splits text at mark boundaries, so a phrase like "needle top"
 * can live across separate text nodes when only "needle" is bold. This searches
 * a flattened text index, then maps each result back to document positions.
 */
export function findMatches(doc: ProseMirrorNode, query: string) {
	const normalizedQuery = query.toLocaleLowerCase();
	const matches: FindMatch[] = [];
	if (!normalizedQuery) return matches;
	const index = buildTextIndex(doc);
	const text = index.text.toLocaleLowerCase();

	let matchIndex = text.indexOf(normalizedQuery);
	while (matchIndex !== -1) {
		const from = index.offsets[matchIndex]?.docPos;
		const to = index.offsets[matchIndex + query.length - 1]?.docPos;
		if (
			from !== null &&
			from !== undefined &&
			to !== null &&
			to !== undefined
		) {
			matches.push({
				from,
				to: to + 1,
			});
		}
		matchIndex = text.indexOf(
			normalizedQuery,
			matchIndex + normalizedQuery.length,
		);
	}

	return matches;
}

/**
 * Builds the plain-text string used for search and records where each character
 * came from in the ProseMirror document.
 *
 * Block boundaries get unmapped newline separators so searches do not match
 * across separate paragraphs.
 */
function buildTextIndex(doc: ProseMirrorNode): TextIndex {
	const offsets: TextOffset[] = [];
	let text = "";

	doc.descendants((node, pos) => {
		if (node.isText) {
			if (!node.text) return;
			text += node.text;
			for (let index = 0; index < node.text.length; index++) {
				offsets.push({ docPos: pos + index });
			}
			return;
		}
		if (!node.isBlock || pos === 0 || text.endsWith("\n")) return;
		text += "\n";
		offsets.push({ docPos: null });
	});

	return { offsets, text };
}

function emptyFindState() {
	return {
		query: "",
		activeIndex: 0,
		matches: [],
	};
}

function reconcileActiveIndex(activeIndex: number, matchCount: number) {
	if (matchCount === 0) return 0;
	return Math.min(activeIndex, matchCount - 1);
}

function normalizeActiveIndex(activeIndex: number, matchCount: number) {
	if (matchCount === 0) return 0;
	return ((activeIndex % matchCount) + matchCount) % matchCount;
}

function scrollMatchIntoView(
	view: {
		coordsAtPos: (pos: number) => { top: number; bottom: number };
		dom: HTMLElement;
	},
	pos: number,
) {
	const viewport = view.dom.closest(".editorViewport") as HTMLElement | null;
	if (!viewport) return;

	const matchRect = view.coordsAtPos(pos);
	const viewportRect = viewport.getBoundingClientRect();
	// The find bar floats over the editor, so keep matches below it without
	// using ProseMirror's broader scrollIntoView behavior.
	const topPadding = 48;
	const bottomPadding = 24;
	const visibleTop = viewportRect.top + topPadding;
	const visibleBottom = viewportRect.bottom - bottomPadding;

	if (matchRect.top < visibleTop) {
		viewport.scrollTop += matchRect.top - visibleTop;
	} else if (matchRect.bottom > visibleBottom) {
		viewport.scrollTop += matchRect.bottom - visibleBottom;
	}
}

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		find: {
			setFindQuery: (query: string) => ReturnType;
			setFindActiveIndex: (activeIndex: number) => ReturnType;
			replaceFindMatch: (replacement: string) => ReturnType;
			replaceAllFindMatches: (replacement: string) => ReturnType;
			clearFindQuery: () => ReturnType;
		};
	}
}
