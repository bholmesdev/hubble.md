import { resetEditorHistory } from "@hubble.md/editor";
import type { Editor, JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

/** Agent updates are separate undo events; disk reloads retain their existing history policy. */
export function replaceEditorContent(
	editor: Editor,
	content: JSONContent,
	undoable: boolean,
	preserveHistory: boolean,
) {
	if (undoable) editor.view.dispatch(closeHistory(editor.state.tr));
	editor
		.chain()
		.setMeta("addToHistory", undoable)
		.setContent(content, { emitUpdate: false })
		.command(({ tr }) => {
			for (const [key, value] of Object.entries(content.attrs ?? {}))
				tr.setDocAttribute(key, value);
			return true;
		})
		.run();
	if (undoable) editor.view.dispatch(closeHistory(editor.state.tr));
	else if (!preserveHistory) resetEditorHistory(editor);
}
