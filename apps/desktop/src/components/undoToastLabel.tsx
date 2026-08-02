import { formatShortcut } from "@hubble.md/ui";

/** Label for the delete toast's undo action: "Undo" plus a keycap shortcut. */
export function undoToastLabel() {
	return (
		<>
			Undo
			<kbd>{formatShortcut("CmdOrCtrl+Z")}</kbd>
		</>
	);
}
