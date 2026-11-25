import { Extension } from "@tiptap/core";
import { ChangeSet } from "@tiptap/pm/changeset";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const key = new PluginKey<{ decorations: DecorationSet; pulse: number }>(
	"toolEditHighlight",
);

export const ToolEditHighlight = Extension.create({
	name: "toolEditHighlight",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key,
				state: {
					init: () => ({ decorations: DecorationSet.empty, pulse: 0 }),
					apply(tr, state) {
						const highlight = tr.getMeta(key);
						if (highlight === "clear")
							return { ...state, decorations: DecorationSet.empty };
						if (Array.isArray(highlight))
							return {
								decorations: DecorationSet.create(tr.doc, highlight),
								pulse: state.pulse + 1,
							};
						return {
							...state,
							decorations: state.decorations.map(tr.mapping, tr.doc),
						};
					},
				},
				props: { decorations: (state) => key.getState(state)?.decorations },
				view: () => {
					let timer: ReturnType<typeof setTimeout> | undefined;
					return {
						update(view, previous) {
							if (
								key.getState(view.state)?.pulse ===
								key.getState(previous)?.pulse
							)
								return;
							clearTimeout(timer);
							timer = setTimeout(() => {
								view.dispatch(
									view.state.tr
										.setMeta(key, "clear")
										.setMeta("addToHistory", false),
								);
							}, 800);
						},
						destroy: () => clearTimeout(timer),
					};
				},
			}),
		];
	},
});

export function highlightToolEdits(tr: Transaction) {
	// setContent replaces the whole document; compare its contents to exclude unchanged passages.
	const changes = ChangeSet.create(tr.before).addSteps(
		tr.doc,
		tr.mapping.maps,
		null,
	);
	const decorations: Decoration[] = [];
	for (const { fromB, toB } of changes.changes) {
		if (fromB === toB) continue;
		tr.doc.nodesBetween(fromB, toB, (node, pos) => {
			if (!node.isTextblock) return;
			if (fromB >= pos + node.nodeSize - 1 || toB <= pos + 1) return false;
			const text = node.textBetween(0, node.content.size, undefined, (leaf) =>
				leaf.type.name === "hardBreak" ? "\n" : "\ufffc",
			);
			const start = Math.max(0, fromB - pos - 1);
			const end = Math.min(text.length, Math.max(0, toB - pos - 1));
			const lineStart = start ? text.lastIndexOf("\n", start - 1) + 1 : 0;
			const newline = text.indexOf("\n", end);
			const lineEnd = newline < 0 ? text.length : newline;
			if (lineStart < lineEnd)
				decorations.push(
					Decoration.inline(pos + 1 + lineStart, pos + 1 + lineEnd, {
						class: "hubble-tool-edit",
					}),
				);
			return false;
		});
	}
	tr.setMeta(key, decorations);
}
