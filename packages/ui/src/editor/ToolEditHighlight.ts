import { Extension } from "@tiptap/core";
import { ChangeSet } from "@tiptap/pm/changeset";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { diffArrays } from "diff";

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
						const highlight = tr.getMeta(key) as
							| { from: number; to: number }[]
							| "clear"
							| undefined;
						if (highlight === "clear")
							return { ...state, decorations: DecorationSet.empty };
						if (Array.isArray(highlight))
							return {
								decorations: DecorationSet.create(
									tr.doc,
									highlight.map(({ from, to }) =>
										Decoration.inline(from, to, {
											// Switching names restarts CSS animation even when ProseMirror reuses its span.
											class: `hubble-tool-edit${state.pulse % 2 ? " hubble-tool-edit-alternate" : ""}`,
										}),
									),
								),
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
	const decorations: { from: number; to: number }[] = [];
	const before = documentTokens(tr.before);
	const after = documentTokens(tr.doc);
	const insertions: { fromB: number; toB: number }[] = [];
	for (const { fromA, toA, fromB, toB } of changes.changes) {
		// ChangeSet joins nearby edits across unchanged text, including deletion-only edits.
		// Skip the pulse if exact refinement takes too long; feedback must not stall editing.
		const parts = diffArrays(
			before.slice(fromA, toA),
			after.slice(fromB, toB),
			{
				timeout: 50,
			},
		);
		let pos = fromB;
		for (const part of parts ?? []) {
			if (part.removed) continue;
			if (part.added) insertions.push({ fromB: pos, toB: pos + part.count });
			pos += part.count;
		}
	}
	for (const { fromB, toB } of insertions) {
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
			const newline = text.indexOf("\n", Math.max(start, end - 1));
			const lineEnd = newline < 0 ? text.length : newline;
			if (lineStart < lineEnd)
				decorations.push({
					from: pos + 1 + lineStart,
					to: pos + 1 + lineEnd,
				});
			return false;
		});
	}
	tr.setMeta(key, decorations);
}

// Each token occupies one ProseMirror position, including node boundaries and UTF-16 text units.
function documentTokens(doc: Node) {
	const tokens: (string | number)[] = [];
	doc.descendants((node, pos) => {
		if (node.isText) {
			const text = node.text ?? "";
			for (let i = 0; i < text.length; i++)
				tokens[pos + i] = text.charCodeAt(i);
		} else {
			tokens[pos] = node.type.name;
			if (!node.isLeaf) tokens[pos + node.nodeSize - 1] = `/${node.type.name}`;
		}
	});
	return tokens;
}
