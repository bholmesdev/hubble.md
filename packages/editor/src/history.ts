import type { Editor } from "@tiptap/core";
import { history } from "@tiptap/pm/history";
import type { Plugin } from "@tiptap/pm/state";

/**
 * Mirrors the defaults of TipTap's `UndoRedo` extension, which StarterKit
 * installs without configuration.
 */
const historyOptions = { depth: 100, newGroupDelay: 500 };

const historyPluginKeyPrefix = "history$";

/**
 * Empties the undo stack by replacing the history plugin with a new one.
 *
 * Call this after swapping the whole document, such as when a different file is
 * opened. The old file's edits would otherwise stay on the stack, so one undo
 * in the new file could restore text that belongs to the old one.
 */
export function resetEditorHistory(editor: Editor) {
	if (editor.isDestroyed) return;
	editor.registerPlugin(history(historyOptions), (plugin, plugins) =>
		plugins.map((existing) =>
			// `key` is public on the plugin spec but missing from the exported type.
			(existing as Plugin & { key: string }).key.startsWith(
				historyPluginKeyPrefix,
			)
				? plugin
				: existing,
		),
	);
}
