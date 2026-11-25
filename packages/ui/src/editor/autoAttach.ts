import { selectionToMarkdown } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import type { EditorAttachment } from "./attachments";

export function watchSelection(
	editor: Editor,
	path: string,
	attach: (attachment: EditorAttachment) => boolean,
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let flash: ReturnType<typeof setTimeout> | undefined;
	let dragging = false;
	let last = "";
	const dom = editor.view.dom;
	const clear = () => clearTimeout(timer);
	const schedule = () => {
		clear();
		if (dragging || editor.state.selection.empty) return;
		const { from, to } = editor.state.selection;
		timer = setTimeout(() => {
			if (editor.isDestroyed || !editor.isFocused) return;
			const selection = editor.state.selection;
			if (selection.empty || selection.from !== from || selection.to !== to)
				return;
			const text = selectionToMarkdown(selection).trimEnd();
			const key = `${from}:${to}:${text}`;
			if (!text || key === last) return;
			if (!attach({ kind: "selection", path, text })) return;
			last = key;
			dom.classList.add("hubble-selection-attached");
			clearTimeout(flash);
			flash = setTimeout(
				() => dom.classList.remove("hubble-selection-attached"),
				800,
			);
		}, 700);
	};
	const down = () => {
		dragging = true;
		clear();
	};
	const up = () => {
		dragging = false;
		schedule();
	};
	dom.addEventListener("pointerdown", down);
	window.addEventListener("pointerup", up);
	dom.addEventListener("keydown", clear);
	dom.addEventListener("keyup", schedule);
	editor.on("selectionUpdate", schedule);
	editor.on("update", schedule);
	return () => {
		clear();
		clearTimeout(flash);
		dom.classList.remove("hubble-selection-attached");
		dom.removeEventListener("pointerdown", down);
		window.removeEventListener("pointerup", up);
		dom.removeEventListener("keydown", clear);
		dom.removeEventListener("keyup", schedule);
		editor.off("selectionUpdate", schedule);
		editor.off("update", schedule);
	};
}
