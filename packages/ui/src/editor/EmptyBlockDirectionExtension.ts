import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type TextDirection = "ltr" | "rtl";

const emptyBlockDirectionKey = new PluginKey<DecorationSet>(
	"emptyBlockDirection",
);

export const EmptyBlockDirectionExtension = Extension.create({
	name: "emptyBlockDirection",

	addProseMirrorPlugins() {
		return [
			new Plugin<DecorationSet>({
				key: emptyBlockDirectionKey,
				state: {
					init: (_, state) => emptyBlockDirections(state.doc),
					apply: (transaction, decorations) =>
						transaction.docChanged
							? emptyBlockDirections(transaction.doc)
							: decorations,
				},
				props: {
					decorations: (state) =>
						emptyBlockDirectionKey.getState(state) ?? DecorationSet.empty,
				},
			}),
		];
	},
});

function emptyBlockDirections(doc: ProseMirrorNode) {
	const decorations: Decoration[] = [];
	let previousText: string | undefined;
	let previousDirection: TextDirection | undefined;

	doc.descendants((node, pos) => {
		if (!node.isTextblock) return;

		if (node.type.name === "codeBlock") {
			previousText = undefined;
			previousDirection = "ltr";
			return;
		}

		if (node.content.size > 0) {
			previousText = node.textContent;
			previousDirection = undefined;
			return;
		}

		if (!previousDirection && previousText !== undefined) {
			previousDirection = directionOf(previousText);
		}
		if (!previousDirection) return;

		decorations.push(
			// A decoration keeps this temporary state out of Markdown and undo history.
			Decoration.node(pos, pos + node.nodeSize, {
				"data-empty-direction": previousDirection,
			}),
		);
	});

	return DecorationSet.create(doc, decorations);
}

function directionOf(text: string): TextDirection {
	// Let Chromium apply the same Unicode bidi rules used by dir=auto.
	const probe = document.createElement("bdi");
	probe.dir = "auto";
	probe.textContent = text;
	return probe.matches(":dir(rtl)") ? "rtl" : "ltr";
}
