import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const FakeSelectionKey = new PluginKey("fakeSelection");

export type FrozenSelection = { from: number; to: number } | null;

/**
 * TipTap v3 extension that preserves a visual selection highlight while the editor is blurred.
 * It does this by rendering a decoration across the last frozen selection range.
 */
export const FakeSelectionExtension = Extension.create({
	name: "fakeSelection",

	addStorage() {
		return {
			frozen: null,
		};
	},

	addCommands() {
		return {
			freezeSelection:
				() =>
				({ editor }) => {
					const { from, to } = editor.state.selection;
					const storage = this.storage as { frozen: FrozenSelection };
					storage.frozen = { from, to };
					// Trigger plugin props recalculation
					editor.view.dispatch(editor.state.tr);
					return true;
				},
			clearFrozenSelection:
				() =>
				({ editor }) => {
					const storage = this.storage as { frozen: FrozenSelection };
					storage.frozen = null;
					editor.view.dispatch(editor.state.tr);
					return true;
				},
			restoreSelection:
				({ focus }) =>
				({ editor, chain }) => {
					const storage = this.storage as { frozen: FrozenSelection };
					const frozen = storage.frozen;
					const newChain = focus ? chain().focus() : chain();
					if (frozen) {
						newChain
							.setTextSelection({ from: frozen.from, to: frozen.to })
							.run();
					} else {
						newChain.run();
					}
					// Clear frozen and force plugin update so decoration disappears
					storage.frozen = null;
					editor.view.dispatch(editor.state.tr);
					return true;
				},
		};
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: FakeSelectionKey,
				props: {
					decorations: (state: EditorState) => {
						const storage = this.storage as { frozen: FrozenSelection };
						const frozen = storage.frozen;
						if (!frozen) return null;
						const { from, to } = frozen;
						if (from === to) return null;
						const deco = Decoration.inline(from, to, {
							class: "pm-fake-selection",
						});
						return DecorationSet.create(state.doc, [deco]);
					},
				},
			}),
		];
	},
});

declare module "@tiptap/core" {
	interface ExtensionStorage {
		fakeSelection: {
			frozen: FrozenSelection;
		};
	}
	interface Commands<ReturnType> {
		fakeSelection: {
			/** Snapshot the current editor selection to display while blurred */
			freezeSelection: () => ReturnType;
			/** Clear the frozen selection without changing the editor selection */
			clearFrozenSelection: () => ReturnType;
			/** Restore the frozen selection into the native DOM selection and focus the editor */
			restoreSelection: ({ focus }: { focus: boolean }) => ReturnType;
		};
	}
}
