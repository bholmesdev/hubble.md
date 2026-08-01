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
	"app.add-folder": {
		defaultBinding: "CmdOrCtrl+Shift+N",
		label: "Add Folder...",
		isEnabled: always,
	},
	"app.open-file": {
		defaultBinding: "CmdOrCtrl+O",
		label: "Open...",
		isEnabled: always,
	},
	"app.open-folder": {
		defaultBinding: "CmdOrCtrl+Shift+O",
		label: "Open Folder...",
		isEnabled: hasWorkspace,
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

export function getCommand<Id extends CommandId>(id: Id) {
	return commandRegistry[id];
}

export function tiptapBinding(id: EditorCommandId) {
	return getCommand(id)
		.defaultBinding.replace("CmdOrCtrl", "Mod")
		.split("+")
		.map((part) => (/^[A-Z]$/.test(part) ? part.toLowerCase() : part))
		.join("-");
}
