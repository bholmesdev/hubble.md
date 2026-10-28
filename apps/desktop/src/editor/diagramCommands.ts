import type { Editor } from "tldraw";
import { desktopApi } from "../desktopApi";
import type { EditCommand, ZoomCommand } from "../desktopApi/types";

// Like `getActiveEditor()` for TipTap: the open diagram's editor is an
// imperative handle, so it lives here rather than in a store.
let active: Editor | null = null;

export function setActiveDiagram(editor: Editor) {
	active = editor;
}

export function clearActiveDiagram(editor: Editor) {
	// An old editor may clean up after its replacement mounts.
	if (active === editor) active = null;
}

export function getActiveDiagram(): Editor | null {
	if (active?.isDisposed) return null;
	return active;
}

/**
 * The canvas owns Edit commands unless focus is elsewhere in the app (a
 * sidebar rename, the terminal) or a text shape is being edited, where the
 * browser's own editing applies.
 */
function diagramOwnsEdit(editor: Editor) {
	if (editor.getEditingShapeId()) return false;
	const focused = document.activeElement;
	return (
		!focused ||
		focused === document.body ||
		editor.getContainer().contains(focused)
	);
}

export function runEditCommand(command: EditCommand) {
	const editor = getActiveDiagram();
	if (!editor || !diagramOwnsEdit(editor)) {
		void desktopApi.runNativeEdit(command);
		return;
	}
	// Edit commands share their names with the editor's methods.
	editor[command]();
}

export function runZoomCommand(command: ZoomCommand) {
	const editor = getActiveDiagram();
	if (!editor) return;
	const opts = { animation: { duration: editor.options.animationMediumMs } };
	if (command === "in") editor.zoomIn(undefined, opts);
	else if (command === "out") editor.zoomOut(undefined, opts);
	else if (command === "reset") editor.resetZoom(undefined, opts);
	else editor.zoomToFit(opts);
}
