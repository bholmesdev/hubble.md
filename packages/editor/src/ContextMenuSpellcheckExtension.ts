import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { nextCodePointIndex, previousCodePointIndex } from "./utils";

const CURSOR_SCALE = 1.5;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_'’]/u;

export type WordRange = { from: number; to: number };

export function wordRangeAtOffset(
	text: string,
	offset: number,
): WordRange | null {
	let index = Math.min(Math.max(offset, 0), text.length);
	if (index > 0 && isWordCharacterBefore(text, index)) {
		index = previousCodePointIndex(text, index);
	} else if (!isWordCharacterAt(text, index)) {
		return null;
	}

	let from = index;
	while (from > 0 && isWordCharacterBefore(text, from)) {
		from = previousCodePointIndex(text, from);
	}

	let to = index;
	while (to < text.length && isWordCharacterAt(text, to)) {
		to = nextCodePointIndex(text, to);
	}

	return from < to ? { from, to } : null;
}

/**
 * Expands a secondary-click on the rendered caret to its adjacent word.
 * Chromium otherwise misses that word during context-menu hit testing, so
 * Electron cannot offer spelling suggestions even when it underlines the word.
 */
export const ContextMenuSpellcheckExtension = Extension.create({
	name: "contextMenuSpellcheck",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handleDOMEvents: {
						mousedown: (view: EditorView, event: MouseEvent) => {
							if (event.button !== 2 || !view.state.selection.empty)
								return false;
							const caret = view.coordsAtPos(view.state.selection.head);
							if (!isWithinVirtualCaret(event, caret)) return false;

							const range = wordRangeAtSelection(
								view.state.doc,
								view.state.selection.head,
							);
							if (!range) return false;

							view.dispatch(
								view.state.tr.setSelection(
									TextSelection.create(view.state.doc, range.from, range.to),
								),
							);
							return false;
						},
					},
				},
			}),
		];
	},
});

function wordRangeAtSelection(
	doc: ProseMirrorNode,
	position: number,
): WordRange | null {
	const $position = doc.resolve(position);
	if (!$position.parent.isTextblock) return null;
	const text = $position.parent.textBetween(
		0,
		$position.parent.content.size,
		"\0",
		"\0",
	);
	const range = wordRangeAtOffset(text, $position.parentOffset);
	if (!range) return null;
	const parentStart = $position.start();
	return { from: parentStart + range.from, to: parentStart + range.to };
}

function isWithinVirtualCaret(
	event: MouseEvent,
	caret: { left: number; right: number; top: number; bottom: number },
) {
	const lineHeight = Math.max(caret.bottom - caret.top, 1);
	const scaledHeight = lineHeight * CURSOR_SCALE;
	const blockInset = (scaledHeight - lineHeight) / 2;
	const width = scaledHeight * 0.02 + 2;
	const inlineSlop = measureCh(event);
	return (
		event.clientX >= caret.left - inlineSlop &&
		event.clientX <= caret.left + width + inlineSlop &&
		event.clientY >= caret.top - blockInset &&
		event.clientY <= caret.bottom + blockInset
	);
}

function measureCh(event: MouseEvent) {
	const target = event.target instanceof Element ? event.target : document.body;
	const style = getComputedStyle(target);
	const context = document.createElement("canvas").getContext("2d");
	if (!context) return Number.parseFloat(style.fontSize) / 2;
	context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	return context.measureText("0").width;
}

function isWordCharacterAt(text: string, index: number) {
	const codePoint = text.codePointAt(index);
	return (
		codePoint !== undefined &&
		WORD_CHARACTER.test(String.fromCodePoint(codePoint))
	);
}

function isWordCharacterBefore(text: string, index: number) {
	return isWordCharacterAt(text, previousCodePointIndex(text, index));
}
