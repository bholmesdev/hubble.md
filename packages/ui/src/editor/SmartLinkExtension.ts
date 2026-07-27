import { Extension } from "@tiptap/core";
import {
	type EditorState,
	Plugin,
	TextSelection,
	type Transaction,
} from "@tiptap/pm/state";
export const FOCUS_LINK_POPOVER_EVENT = "hubble:focus-link-popover";
export const LINK_CREATION_REQUESTED_EVENT = "hubble:link-creation-requested";

function toggleLinkAtSelection() {
	return () =>
		({
			state,
			dispatch,
		}: {
			state: EditorState;
			dispatch?: (tr: Transaction) => void;
		}) => {
			const linkType = state.schema.marks.link;
			if (!linkType) return false;

			const { selection } = state;

			// Empty selection: enter creation flow (no mark inserted yet)
			if (selection.empty) {
				window.dispatchEvent(
					new CustomEvent(LINK_CREATION_REQUESTED_EVENT, {
						detail: { pos: selection.from },
					}),
				);
				return true;
			}

			// Non-empty selection: apply link mark to selection
			const range = { from: selection.from, to: selection.to };
			const hasLink = state.doc.rangeHasMark(range.from, range.to, linkType);
			if (!hasLink) {
				const tr = state.tr.addMark(
					range.from,
					range.to,
					linkType.create({ href: "" }),
				);
				tr.setSelection(TextSelection.create(tr.doc, range.to));
				dispatch?.(tr);
			}
			window.dispatchEvent(new CustomEvent(FOCUS_LINK_POPOVER_EVENT));
			return true;
		};
}

export const SmartLinkExtension = Extension.create({
	name: "smartLinkToggle",
	priority: 1000,
	addCommands() {
		return {
			toggleLinkAtSelection: toggleLinkAtSelection(),
		};
	},
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handleTextInput(view, from, _to, text) {
						// Detect `[[` to expand link popover
						if (text !== "[") return false;
						if (
							from <= 1 ||
							view.state.doc.textBetween(from - 1, from) !== "["
						) {
							return false;
						}

						const pos = from - 1;
						const tr = view.state.tr.delete(pos, from);
						tr.setSelection(TextSelection.create(tr.doc, pos));
						view.dispatch(tr);
						window.dispatchEvent(
							new CustomEvent(LINK_CREATION_REQUESTED_EVENT, {
								detail: { pos },
							}),
						);
						return true;
					},
				},
			}),
		];
	},
});

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		smartLinkToggle: {
			toggleLinkAtSelection: () => ReturnType;
		};
	}
}
