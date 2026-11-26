import { resetEditorHistory } from "@hubble.md/editor";
import type { Editor, JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";

/** Programmatic updates are separate undo events; disk reloads retain their existing history policy. */
export function replaceEditorContent(
	editor: Editor,
	content: JSONContent,
	undoable: boolean,
	preserveHistory: boolean,
	update?: (transaction: Transaction) => void,
) {
	if (undoable) editor.view.dispatch(closeHistory(editor.state.tr));
	const chain = editor
		.chain()
		.setMeta("addToHistory", undoable)
		.setMeta("preventUpdate", true);
	if (!editor.state.doc.content.eq(editor.schema.nodeFromJSON(content).content))
		chain.setContent(content, { emitUpdate: false });
	chain
		.command(({ tr }) => {
			update?.(tr);
			return true;
		})
		.run();
	if (undoable) editor.view.dispatch(closeHistory(editor.state.tr));
	else if (!preserveHistory) resetEditorHistory(editor);
}
