import {
	type CommandId,
	getCommandBinding,
	getCommandBindings,
	resolveCommandBinding,
	subscribeCommandBindings,
} from "@hubble.md/editor";
import { isMac } from "keymatch";
import { useSyncExternalStore } from "react";

// macOS renders modifiers as adjacent glyphs (⌘⌥R); Windows/Linux use
// "+"-joined words (Ctrl+Alt+R). Keys are matched against the same
// "CmdOrCtrl+..." accelerator syntax used by keymatch and Electron menus, so a
// shortcut's display string and its matcher stay in sync.
const MAC_SYMBOLS: Record<string, string> = {
	mod: "⌘",
	cmd: "⌘",
	command: "⌘",
	cmdorctrl: "⌘",
	commandorcontrol: "⌘",
	ctrl: "⌃",
	control: "⌃",
	alt: "⌥",
	option: "⌥",
	opt: "⌥",
	shift: "⇧",
	backspace: "⌫",
	enter: "⏎",
	return: "⏎",
};

const OTHER_WORDS: Record<string, string> = {
	mod: "Ctrl",
	cmd: "Ctrl",
	command: "Ctrl",
	cmdorctrl: "Ctrl",
	commandorcontrol: "Ctrl",
	ctrl: "Ctrl",
	control: "Ctrl",
	alt: "Alt",
	option: "Alt",
	opt: "Alt",
	shift: "Shift",
	backspace: "Backspace",
	enter: "Enter",
	return: "Enter",
};

/**
 * Formats a platform-agnostic shortcut spec into a display string.
 *
 * @example formatShortcut("CmdOrCtrl+Alt+R") // "⌘⌥R" on macOS, "Ctrl+Alt+R" elsewhere
 */
export function formatShortcut(spec: string): string {
	const mac = isMac();
	const map = mac ? MAC_SYMBOLS : OTHER_WORDS;
	const rendered = spec.split("+").map((raw) => {
		const part = raw.trim();
		const mapped = map[part.toLowerCase()];
		if (mapped) return mapped;
		// A bare key (letter, digit, punctuation): uppercase single letters.
		return part.length === 1 ? part.toUpperCase() : part;
	});
	return mac ? rendered.join("") : rendered.join("+");
}

export function formatCommandShortcut(
	id: CommandId,
	bindings?: ReturnType<typeof getCommandBindings>,
): string | null {
	const binding = bindings
		? resolveCommandBinding(id, bindings)
		: getCommandBinding(id);
	return binding ? formatShortcut(binding) : null;
}

export function useCommandBindings() {
	return useSyncExternalStore(
		subscribeCommandBindings,
		getCommandBindings,
		getCommandBindings,
	);
}

export function useCommandShortcut(id: CommandId) {
	const bindings = useCommandBindings();
	return formatCommandShortcut(id, bindings);
}

export function useCommandShortcutLabel(label: string, id: CommandId) {
	const shortcut = useCommandShortcut(id);
	return shortcut ? `${label} (${shortcut})` : label;
}
