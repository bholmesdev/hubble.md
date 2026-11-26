import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Step, StepResult } from "@tiptap/pm/transform";
import type { FrontMatterState } from "./FilePropertiesPanel";

type FrontMatterSnapshot = { raw: string; properties: FrontMatterState };

export const frontMatterKey = new PluginKey<FrontMatterSnapshot>("frontMatter");

export const FrontMatterHistory = Extension.create<{
	initial: FrontMatterSnapshot;
}>({
	name: "frontMatterHistory",
	addProseMirrorPlugins() {
		const initial = this.options.initial;
		return [
			new Plugin({
				key: frontMatterKey,
				state: {
					init: () => initial,
					apply(transaction, previous) {
						return transaction.steps.reduce(
							(snapshot, step) =>
								step instanceof FrontMatterStep ? step.after : snapshot,
							previous,
						);
					},
				},
			}),
		];
	},
});

// Root-document attributes force ProseMirror to remount every node view. A
// metadata-only step joins Undo without replacing images, embeds, or body text.
export class FrontMatterStep extends Step {
	constructor(
		readonly before: FrontMatterSnapshot,
		readonly after: FrontMatterSnapshot,
	) {
		super();
	}
	apply(doc: Node) {
		return StepResult.ok(doc);
	}
	invert() {
		return new FrontMatterStep(this.after, this.before);
	}
	map() {
		return this;
	}
	toJSON(): never {
		// Editor history is not persisted; it includes session-only property drafts.
		throw Error("Front-matter history is session-local");
	}
}

export function readFrontMatter(state: EditorState): FrontMatterSnapshot {
	const snapshot = frontMatterKey.getState(state);
	if (!snapshot) throw Error("Front-matter history is not installed");
	return snapshot;
}
