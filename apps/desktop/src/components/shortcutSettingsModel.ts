import {
	type CommandBindings,
	type CommandId,
	commandRegistry,
	getCommand,
	isDefaultCommandBinding,
	resolveCommandBinding,
	sortCommandBinding,
} from "@hubble.md/editor";
import { formatShortcut } from "@hubble.md/ui";
import { isMac } from "keymatch";

export type ShortcutCommand = {
	id: CommandId;
	label: string;
	description: string;
	area: "App" | "Editor";
};

const descriptions: Record<CommandId, string> = {
	"app.new-file": "Create a Markdown file in the open folder.",
	"app.open-recent": "Switch to another recently opened folder.",
	"app.open-file": "Choose a file from the filesystem.",
	"app.open-folder": "Choose a folder to open as a workspace.",
	"app.go-to-file": "Search files in the current open folder.",
	"app.settings": "Open Hubble settings.",
	"app.go-back": "Move backward through file history.",
	"app.go-forward": "Move forward through file history.",
	"app.toggle-terminal": "Show or hide the terminal panel.",
	"app.toggle-source-mode": "Switch between rich and source editing.",
	"app.copy-as-markdown": "Copy the current selection as Markdown.",
	"app.copy-path": "Copy the selected file path.",
	"app.reveal": "Reveal the selected item in Finder or Explorer.",
	"app.chat-about-note": "Open the configured agent command for this note.",
	"app.toggle-sidebar": "Show or hide the file sidebar.",
	"app.delete": "Delete the selected file or folder.",
	"app.find": "Find text in the current file.",
	"app.format-menu": "Open the editor formatting menu.",
	"editor.link": "Add or edit a link.",
	"editor.strike": "Toggle strikethrough formatting.",
	"editor.ordered-list": "Toggle a numbered list.",
	"editor.bullet-list": "Toggle a bulleted list.",
	"editor.task-list": "Toggle a to-do list.",
	"editor.bold": "Toggle bold formatting.",
	"editor.italic": "Toggle italic formatting.",
	"editor.code": "Toggle inline code formatting.",
	"editor.heading-1": "Convert the current block to heading 1.",
	"editor.heading-2": "Convert the current block to heading 2.",
	"editor.heading-3": "Convert the current block to heading 3.",
	"editor.heading-4": "Convert the current block to heading 4.",
	"editor.heading-5": "Convert the current block to heading 5.",
	"editor.heading-6": "Convert the current block to heading 6.",
	"editor.blockquote": "Toggle block quote formatting.",
};

export const shortcutCommands = (
	Object.keys(commandRegistry) as CommandId[]
).map((id): ShortcutCommand => {
	const command = getCommand(id);
	return {
		id,
		label: command.label,
		description: descriptions[id],
		area: id.startsWith("app.") ? "App" : "Editor",
	};
});

export function filterShortcutGroups(
	query: string,
	bindings: CommandBindings = {},
) {
	const needle = query.trim().toLocaleLowerCase();
	const filtered = needle
		? shortcutCommands.filter((command) => {
				const binding = resolveCommandBinding(command.id, bindings);
				return `${command.label} ${command.description} ${command.id} ${command.area} ${binding ?? ""} ${binding ? formatShortcut(binding) : ""}`
					.toLocaleLowerCase()
					.includes(needle);
			})
		: shortcutCommands;

	return (["App", "Editor"] as const).flatMap((area) => {
		const commands = filtered.filter((command) => command.area === area);
		return commands.length > 0 ? [{ area, commands }] : [];
	});
}

export function isShortcutCustomized(id: CommandId, bindings: CommandBindings) {
	return !isDefaultCommandBinding(id, resolveCommandBinding(id, bindings));
}

const commonFixedBindings = bindingSet([
	"CmdOrCtrl+A",
	"CmdOrCtrl+C",
	"CmdOrCtrl+=",
	"CmdOrCtrl+-",
	"CmdOrCtrl+0",
	"CmdOrCtrl+V",
	"CmdOrCtrl+X",
	"CmdOrCtrl+Y",
	"CmdOrCtrl+Z",
	"CmdOrCtrl+Shift+Z",
	"Ctrl+`",
]);
const macFixedBindings = bindingSet([
	"CmdOrCtrl+Q",
	"CmdOrCtrl+W",
	"CmdOrCtrl+H",
	"CmdOrCtrl+Alt+H",
	"CmdOrCtrl+M",
]);
const macUnavailableBindings = bindingSet([
	"CmdOrCtrl+Space",
	"CmdOrCtrl+Tab",
	"CmdOrCtrl+`",
	"CmdOrCtrl+Alt+Escape",
	"CmdOrCtrl+Shift+3",
	"CmdOrCtrl+Shift+4",
	"CmdOrCtrl+Shift+5",
	"CmdOrCtrl+Ctrl+Space",
	"CmdOrCtrl+Ctrl+Q",
	"CmdOrCtrl+Shift+Q",
	"CmdOrCtrl+Alt+Shift+Q",
]);
const otherUnavailableBindings = bindingSet([
	"Alt+F4",
	"Alt+Tab",
	"Alt+Escape",
	"Ctrl+Alt+Delete",
	"Ctrl+Shift+Escape",
]);

export function validateShortcutBinding(binding: string, mac = isMac()) {
	const sortedBinding = sortCommandBinding(binding);
	const parts = sortedBinding.split("+");
	if (parts.some((part) => part.length === 0)) {
		return "That key cannot be used in a Hubble shortcut.";
	}
	if (parts.includes("Super")) {
		return "The system key is not available for app shortcuts.";
	}
	if (
		!parts.some(
			(part) => part === "CmdOrCtrl" || part === "Ctrl" || part === "Alt",
		)
	) {
		return mac
			? "Add a modifier (⌘, ⌥, ⌃) to create a shortcut."
			: "Add a modifier (Ctrl, Alt) to create a shortcut.";
	}

	if (
		commonFixedBindings.has(sortedBinding) ||
		(mac && macFixedBindings.has(sortedBinding))
	) {
		return `${formatShortcut(binding)} stays fixed in Hubble.`;
	}

	const unavailableBindings = mac
		? macUnavailableBindings
		: otherUnavailableBindings;
	if (unavailableBindings.has(sortedBinding)) {
		return `${formatShortcut(binding)} is unavailable on this operating system.`;
	}
}

export function shortcutBindingFromEvent(
	event: KeyboardEvent,
	mac = isMac(),
): string | null {
	const keyAliases: Record<string, string> = {
		" ": "Space",
		ArrowDown: "Down",
		ArrowLeft: "Left",
		ArrowRight: "Right",
		ArrowUp: "Up",
	};
	const key = /^Key[A-Z]$/.test(event.code)
		? event.code.slice(3)
		: /^Digit[0-9]$/.test(event.code)
			? event.code.slice(5)
			: (keyAliases[event.key] ?? event.key);
	if (["Alt", "Control", "Meta", "Shift"].includes(key)) return null;

	const parts: string[] = [];
	if (event.ctrlKey) parts.push(mac ? "Ctrl" : "CmdOrCtrl");
	if (event.metaKey) parts.push(mac ? "CmdOrCtrl" : "Super");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	parts.push(key.length === 1 ? key.toUpperCase() : key);
	return sortCommandBinding(parts.join("+"));
}

function bindingSet(bindings: string[]) {
	return new Set(bindings.map(sortCommandBinding));
}
