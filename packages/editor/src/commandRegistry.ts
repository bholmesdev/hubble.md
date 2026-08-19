export type CommandContext = {
	hasCurrentFile?: boolean;
	hasEditableFile?: boolean;
	hasSourceViewOpen?: boolean;
	hasWorkspace?: boolean;
	isSourceMode?: boolean;
	canGoBack?: boolean;
	canGoForward?: boolean;
};

export type CommandDefinition = {
	defaultBinding: string;
	label: string;
	isEnabled: (context: CommandContext) => boolean;
};

const always = () => true;
const hasCurrentFile = (context: CommandContext) =>
	context.hasCurrentFile === true;
const hasEditableFile = (context: CommandContext) =>
	context.hasEditableFile === true;
const hasSourceViewOpen = (context: CommandContext) =>
	context.hasSourceViewOpen === true;
const hasWorkspace = (context: CommandContext) => context.hasWorkspace === true;

// Context-sensitive structural keys (Enter, Tab, Mod-a, Escape, and
// ProseMirror handleKeyDown plugins), OS zoom conventions, and Electron roles
// remain fixed at their execution sites rather than becoming named commands.
export const commandRegistry = {
	"app.new-file": {
		defaultBinding: "CmdOrCtrl+N",
		label: "New File",
		isEnabled: always,
	},
	"app.open-recent": {
		defaultBinding: "Ctrl+R",
		label: "Open Recent",
		isEnabled: hasWorkspace,
	},
	"app.open-file": {
		defaultBinding: "CmdOrCtrl+O",
		label: "Open...",
		isEnabled: always,
	},
	"app.open-folder": {
		defaultBinding: "CmdOrCtrl+Shift+O",
		label: "Open Folder...",
		isEnabled: always,
	},
	"app.go-to-file": {
		defaultBinding: "CmdOrCtrl+P",
		label: "Go to File...",
		isEnabled: hasWorkspace,
	},
	"app.settings": {
		defaultBinding: "CmdOrCtrl+,",
		label: "Settings...",
		isEnabled: always,
	},
	"app.go-back": {
		defaultBinding: "CmdOrCtrl+[",
		label: "Go Back",
		isEnabled: (context) => context.canGoBack === true,
	},
	"app.go-forward": {
		defaultBinding: "CmdOrCtrl+]",
		label: "Go Forward",
		isEnabled: (context) => context.canGoForward === true,
	},
	"app.toggle-terminal": {
		defaultBinding: "CmdOrCtrl+J",
		label: "Toggle Terminal",
		isEnabled: hasWorkspace,
	},
	"app.toggle-source-mode": {
		defaultBinding: "Alt+CmdOrCtrl+U",
		label: "Toggle Source Mode",
		isEnabled: hasSourceViewOpen,
	},
	"app.copy-as-markdown": {
		defaultBinding: "Alt+CmdOrCtrl+C",
		label: "Copy as Markdown",
		isEnabled: (context) => context.isSourceMode !== true,
	},
	"app.copy-path": {
		defaultBinding: "CmdOrCtrl+Shift+C",
		label: "Copy File Path",
		isEnabled: hasCurrentFile,
	},
	"app.reveal": {
		defaultBinding: "CmdOrCtrl+Alt+R",
		label: "Reveal in File Manager",
		isEnabled: hasCurrentFile,
	},
	"app.chat-about-note": {
		defaultBinding: "CmdOrCtrl+Shift+J",
		label: "Chat About Note",
		isEnabled: (context) =>
			context.hasEditableFile === true && context.hasWorkspace === true,
	},
	"app.toggle-sidebar": {
		defaultBinding: "CmdOrCtrl+Shift+E",
		label: "Toggle Sidebar",
		isEnabled: always,
	},
	"app.delete": {
		defaultBinding: "CmdOrCtrl+Backspace",
		label: "Delete",
		isEnabled: hasCurrentFile,
	},
	"app.find": {
		defaultBinding: "CmdOrCtrl+F",
		label: "Find",
		isEnabled: hasEditableFile,
	},
	"app.format-menu": {
		defaultBinding: "CmdOrCtrl+/",
		label: "Format",
		isEnabled: hasEditableFile,
	},
	"editor.link": {
		defaultBinding: "CmdOrCtrl+K",
		label: "Link",
		isEnabled: always,
	},
	"editor.strike": {
		defaultBinding: "CmdOrCtrl+Shift+X",
		label: "Strikethrough",
		isEnabled: always,
	},
	"editor.ordered-list": {
		defaultBinding: "CmdOrCtrl+Shift+7",
		label: "Numbered List",
		isEnabled: always,
	},
	"editor.bullet-list": {
		defaultBinding: "CmdOrCtrl+Shift+8",
		label: "Bulleted List",
		isEnabled: always,
	},
	"editor.task-list": {
		defaultBinding: "CmdOrCtrl+Shift+9",
		label: "To-do List",
		isEnabled: always,
	},
	"editor.bold": {
		defaultBinding: "CmdOrCtrl+B",
		label: "Bold",
		isEnabled: always,
	},
	"editor.italic": {
		defaultBinding: "CmdOrCtrl+I",
		label: "Italic",
		isEnabled: always,
	},
	"editor.code": {
		defaultBinding: "CmdOrCtrl+E",
		label: "Inline Code",
		isEnabled: always,
	},
	"editor.heading-1": {
		defaultBinding: "CmdOrCtrl+Alt+1",
		label: "Heading 1",
		isEnabled: always,
	},
	"editor.heading-2": {
		defaultBinding: "CmdOrCtrl+Alt+2",
		label: "Heading 2",
		isEnabled: always,
	},
	"editor.heading-3": {
		defaultBinding: "CmdOrCtrl+Alt+3",
		label: "Heading 3",
		isEnabled: always,
	},
	"editor.heading-4": {
		defaultBinding: "CmdOrCtrl+Alt+4",
		label: "Heading 4",
		isEnabled: always,
	},
	"editor.heading-5": {
		defaultBinding: "CmdOrCtrl+Alt+5",
		label: "Heading 5",
		isEnabled: always,
	},
	"editor.heading-6": {
		defaultBinding: "CmdOrCtrl+Alt+6",
		label: "Heading 6",
		isEnabled: always,
	},
	"editor.blockquote": {
		defaultBinding: "CmdOrCtrl+Shift+B",
		label: "Quote",
		isEnabled: always,
	},
} as const satisfies Record<string, CommandDefinition>;

export type CommandId = keyof typeof commandRegistry;
export type AppCommandId = Extract<CommandId, `app.${string}`>;
export type EditorCommandId = Extract<CommandId, `editor.${string}`>;
export type CommandBindings = Partial<Record<CommandId, string | null>>;

let commandBindings: CommandBindings = {};
const bindingListeners = new Set<() => void>();
const commandIds = Object.keys(commandRegistry) as CommandId[];
const bindingPartOrder = ["CmdOrCtrl", "Ctrl", "Alt", "Shift", "Super"];
const bindingParts = new Set(bindingPartOrder);

export function getCommand<Id extends CommandId>(id: Id) {
	return commandRegistry[id];
}

export function getCommandBinding(id: CommandId) {
	const binding = resolveCommandBinding(id, commandBindings);
	if (!binding) return binding;
	const bindingKey = sortCommandBinding(binding);
	for (const commandId of commandIds) {
		if (commandId === id) return binding;
		const otherBinding = resolveCommandBinding(commandId, commandBindings);
		if (otherBinding && sortCommandBinding(otherBinding) === bindingKey) {
			return null;
		}
	}
	return binding;
}

export function resolveCommandBinding(
	id: CommandId,
	bindings: CommandBindings,
) {
	return bindings[id] === undefined
		? getCommand(id).defaultBinding
		: bindings[id];
}

export function findCommandBindingConflicts(
	id: CommandId,
	bindings: CommandBindings,
) {
	const binding = resolveCommandBinding(id, bindings);
	if (!binding) return [];
	const bindingKey = sortCommandBinding(binding);
	return commandIds.filter((commandId) => {
		if (commandId === id) return false;
		const otherBinding = resolveCommandBinding(commandId, bindings);
		return (
			otherBinding !== null && sortCommandBinding(otherBinding) === bindingKey
		);
	});
}

export function sortCommandBinding(binding: string) {
	const parts = binding.split("+");
	const modifiers = bindingPartOrder.filter((part) => parts.includes(part));
	const keys = parts.filter((part) => !bindingParts.has(part));
	return [...modifiers, ...keys].join("+");
}

export function setCommandBindings(bindings: CommandBindings) {
	commandBindings = cleanCommandBindings(bindings);
	for (const listener of bindingListeners) listener();
}

export function getCommandBindings() {
	return commandBindings;
}

export function subscribeCommandBindings(listener: () => void) {
	bindingListeners.add(listener);
	return () => {
		bindingListeners.delete(listener);
	};
}

export function cleanCommandBindings(value: unknown): CommandBindings {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const bindings: CommandBindings = {};
	for (const [id, binding] of Object.entries(value)) {
		if (!(id in commandRegistry)) continue;
		if (binding !== null && (typeof binding !== "string" || !binding)) continue;
		const commandId = id as CommandId;
		if (binding !== getCommand(commandId).defaultBinding) {
			bindings[commandId] = binding;
		}
	}
	return bindings;
}

export function tiptapBinding(id: EditorCommandId) {
	const binding = getCommandBinding(id);
	return binding ? toTiptapBinding(binding) : null;
}

export function toTiptapBinding(binding: string) {
	return binding
		.replace("CmdOrCtrl", "Mod")
		.split("+")
		.map((part) => (/^[A-Z]$/.test(part) ? part.toLowerCase() : part))
		.join("-");
}
