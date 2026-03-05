import { Extension } from "@tiptap/core";
import type { Mark, MarkType } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

type BoundaryType = "start" | "end";
type BoundaryMatch = { markType: MarkType; boundary: BoundaryType };
type EscapedBoundaryState = { pos: number; markName: string } | null;

export type CaretFormattingState = {
	activeMarkNames: string[];
	canEscapeBoundary: boolean;
};

export const MARK_PRIORITY = [
	"code",
	"bold",
	"italic",
	"strike",
	"link",
] as const;
export const DELIMITER_BY_MARK: Record<
	string,
	{ start: string; end: string } | undefined
> = {
	code: { start: "`", end: "`" },
	bold: { start: "**", end: "**" },
	italic: { start: "*", end: "*" },
	strike: { start: "~~", end: "~~" },
	link: { start: "[", end: "]" },
};
export const MarkdownRolloverKey = new PluginKey<EscapedBoundaryState>(
	"markdownRollover",
);

export function getCaretFormattingState(
	state: EditorState,
): CaretFormattingState {
	const escapedBoundary = MarkdownRolloverKey.getState(state) ?? null;
	return {
		activeMarkNames: getActiveMarkNamesAtCursor(state, escapedBoundary),
		canEscapeBoundary: canEscapeBoundaryAtCursor(state, escapedBoundary),
	};
}

export const MarkdownRolloverExtension = Extension.create({
	name: "markdownRollover",
	addProseMirrorPlugins() {
		return [
			new Plugin<EscapedBoundaryState>({
				key: MarkdownRolloverKey,
				state: {
					init: () => null,
					apply: (tr, prev, _oldState, newState) => {
						const meta = tr.getMeta(MarkdownRolloverKey) as
							| EscapedBoundaryState
							| undefined;
						if (meta !== undefined) return meta;
						if (!prev || !newState.selection.empty) return null;

						const boundaryMatch = getBoundaryMatchAtPos(
							newState,
							newState.selection.from,
						);
						if (!boundaryMatch) return null;
						if (
							prev.pos === newState.selection.from &&
							prev.markName === boundaryMatch.markType.name
						) {
							return prev;
						}
						return null;
					},
				},
				props: {
					handleKeyDown: (view, event) => {
						if (event.key !== "Escape") return false;
						const handled = maybeHandleEscapeAtBoundary(view);
						if (!handled) return false;
						event.preventDefault();
						return true;
					},
				},
			}),
		];
	},
});

function maybeHandleEscapeAtBoundary(view: EditorView): boolean {
	const { state } = view;
	const escapedBoundary = MarkdownRolloverKey.getState(state) ?? null;
	if (!canEscapeBoundaryAtCursor(state, escapedBoundary)) return false;

	const boundaryMatch = getBoundaryMatchAtPos(state, state.selection.from);
	if (boundaryMatch) {
		const tr = state.tr.removeStoredMark(boundaryMatch.markType);
		tr.setMeta(MarkdownRolloverKey, {
			pos: state.selection.from,
			markName: boundaryMatch.markType.name,
		} satisfies NonNullable<EscapedBoundaryState>);
		view.dispatch(tr);
		return true;
	}

	let tr = state.tr;
	for (const markName of MARK_PRIORITY) {
		const markType = state.schema.marks[markName];
		if (markType) {
			tr = tr.removeStoredMark(markType);
		}
	}
	view.dispatch(tr);
	return true;
}

function canEscapeBoundaryAtCursor(
	state: EditorState,
	escapedBoundary: EscapedBoundaryState,
): boolean {
	if (!state.selection.empty) return false;

	const boundaryMatch = getBoundaryMatchAtPos(state, state.selection.from);
	if (boundaryMatch) {
		if (boundaryMatch.boundary !== "end") return false;
		if (
			isBoundaryEscaped(
				escapedBoundary,
				state.selection.from,
				boundaryMatch.markType.name,
			)
		) {
			return false;
		}
		return isMarkEffectivelyActiveAtCursor(state, boundaryMatch.markType);
	}

	return hasStoredFormattingMarks(state);
}

function getBoundaryMatchAtPos(
	state: EditorState,
	pos: number,
): BoundaryMatch | null {
	const $pos = state.doc.resolve(pos);
	const beforeMarks = $pos.nodeBefore?.marks ?? [];
	const afterMarks = $pos.nodeAfter?.marks ?? [];

	for (const markName of MARK_PRIORITY) {
		const markType = state.schema.marks[markName];
		if (!markType) continue;
		const hasBefore = !!markType.isInSet(beforeMarks);
		const hasAfter = !!markType.isInSet(afterMarks);
		if (!hasBefore && hasAfter) return { markType, boundary: "start" };
		if (hasBefore && !hasAfter) return { markType, boundary: "end" };
	}

	return null;
}

function getActiveMarkNamesAtCursor(
	state: EditorState,
	escapedBoundary: EscapedBoundaryState,
) {
	if (!state.selection.empty) return [];
	const names = new Set(
		(state.storedMarks ?? state.selection.$from.marks()).map(
			(mark) => mark.type.name,
		),
	);

	const boundaryMatch = getBoundaryMatchAtPos(state, state.selection.from);
	if (
		boundaryMatch &&
		boundaryMatch.boundary === "end" &&
		!isBoundaryEscaped(
			escapedBoundary,
			state.selection.from,
			boundaryMatch.markType.name,
		) &&
		isMarkEffectivelyActiveAtCursor(state, boundaryMatch.markType)
	) {
		names.add(boundaryMatch.markType.name);
	}

	return MARK_PRIORITY.filter((name) => names.has(name));
}

function isMarkActiveForInsertion(state: EditorState, markType: MarkType) {
	const marks = state.storedMarks ?? state.selection.$from.marks();
	return !!markType.isInSet(marks);
}

function isMarkEffectivelyActiveAtCursor(
	state: EditorState,
	markType: MarkType,
) {
	if (isMarkActiveForInsertion(state, markType)) return true;
	return !!getAdjacentInsertionMark(state, markType);
}

function hasStoredFormattingMarks(state: EditorState): boolean {
	if (!state.storedMarks) return false;
	return state.storedMarks.some((mark) =>
		(MARK_PRIORITY as readonly string[]).includes(mark.type.name),
	);
}

function isBoundaryEscaped(
	escapedBoundary: EscapedBoundaryState,
	pos: number,
	markName: string,
) {
	return (
		!!escapedBoundary &&
		escapedBoundary.pos === pos &&
		escapedBoundary.markName === markName
	);
}

function getAdjacentInsertionMark(
	state: EditorState,
	markType: MarkType,
): Mark | null {
	if (!state.selection.empty) return null;
	const $pos = state.doc.resolve(state.selection.from);
	const after = markType.isInSet($pos.nodeAfter?.marks ?? []);
	if (after) return after;
	const before = markType.isInSet($pos.nodeBefore?.marks ?? []);
	if (before) return before;
	return null;
}

function findByPriority(
	state: EditorState,
	marks: readonly Mark[],
): MarkType | null {
	for (const markName of MARK_PRIORITY) {
		const markType = state.schema.marks[markName];
		if (markType?.isInSet(marks)) return markType;
	}
	return null;
}

export const __testing = {
	canEscapeBoundaryAtCursor,
	findByPriority,
	getBoundaryMatchAtPos,
	hasStoredFormattingMarks,
	isBoundaryEscaped,
};
