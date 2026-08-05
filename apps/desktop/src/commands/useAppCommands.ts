import {
	type CommandId,
	getCommand,
	type CommandContext as RegistryContext,
} from "@hubble.md/editor";
import {
	type EditorActionId,
	formatShortcut,
	type PaletteCommand,
	runEditorAction,
} from "@hubble.md/ui";
import { toast } from "sonner";
import { desktopApi } from "../desktopApi";
import { createMarkdownFile } from "../fileActions";
import { isChangelogPath } from "../lib/changelogNote";
import { copyText } from "../lib/clipboard";
import {
	basename,
	hasMarkdownExtension,
	isEditableFile,
	supportsSourceToggle,
} from "../lib/filePath";
import {
	createFolderInFolder,
	deleteMarkdownFile,
	goBack,
	goForward,
	openChangelog,
	openWorkspaceWithSidebar,
	requestChatAboutNote,
	setSidebarOpen,
	setThemePreference,
	setViewerMode,
	setWorkspaceSwitcherOpen,
	togglePinnedNote,
	toggleSidebar,
	toggleTerminal,
} from "../store/actions";
import { canGoBack, canGoForward } from "../store/history";

const CONTRIBUTING_URL =
	"https://github.com/bholmesdev/hubble.md/blob/main/CONTRIBUTING.md";

export type AppCommandContext = {
	currentPath: string | null;
	newFolderParent: string | null;
	workspacePath: string | null;
	isSourceMode: boolean;
	sidebarOpen: boolean;
	isDark: boolean;
	isPinned: boolean;
};

export type AppCommandActions = {
	openSettings: () => void;
	requestCopyAsMarkdown: () => void;
	focusSidebar: () => void;
};

function toRegistryContext(context: AppCommandContext): RegistryContext {
	const path = context.currentPath;
	const isRealFile = path !== null && !isChangelogPath(path);
	return {
		hasCurrentFile: isRealFile,
		hasEditableFile: isRealFile && isEditableFile(path),
		hasSourceViewOpen: isRealFile && supportsSourceToggle(path),
		hasWorkspace: context.workspacePath !== null,
		isSourceMode: context.isSourceMode,
		canGoBack: canGoBack(),
		canGoForward: canGoForward(),
	};
}

function hasRichTextEditor(context: AppCommandContext) {
	const path = context.currentPath;
	return (
		path !== null &&
		!isChangelogPath(path) &&
		hasMarkdownExtension(path) &&
		!context.isSourceMode
	);
}

type CommandDeclaration = Omit<PaletteCommand, "binding" | "shortcut"> & {
	binding?: string;
	isEnabled: () => boolean;
};

function defineCommands(
	actions: AppCommandActions,
	context: AppCommandContext,
): CommandDeclaration[] {
	const path = context.currentPath;
	const registry = toRegistryContext(context);

	const fromRegistry = (
		id: CommandId,
		group: string,
		keywords: string[],
		run: () => void | Promise<void>,
		options?: {
			destructive?: boolean;
			globalShortcut?: boolean;
			label?: string;
			isEnabled?: () => boolean;
		},
	): CommandDeclaration => {
		const command = getCommand(id);
		return {
			id,
			label: options?.label ?? command.label,
			group,
			keywords,
			binding: command.defaultBinding,
			destructive: options?.destructive,
			globalShortcut: options?.globalShortcut ?? true,
			isEnabled: options?.isEnabled ?? (() => command.isEnabled(registry)),
			run,
		};
	};

	const paletteOnly = (declaration: CommandDeclaration): CommandDeclaration =>
		declaration;

	const editorCommand = (
		id: Extract<CommandId, `editor.${string}`>,
		action: EditorActionId,
		keywords: string[],
	) =>
		fromRegistry(
			id,
			"Editor",
			keywords,
			() => {
				if (!runEditorAction(action)) {
					throw new Error("No active editor");
				}
			},
			{
				globalShortcut: false,
				// The registry assumes editor-local use.
				isEnabled: () => hasRichTextEditor(context),
			},
		);

	return [
		// File
		fromRegistry("app.new-file", "File", ["create", "markdown", "note"], () =>
			createMarkdownFile(),
		),
		paletteOnly({
			id: "app.new-folder",
			label: "New Folder",
			group: "File",
			keywords: ["create", "directory"],
			isEnabled: () => context.newFolderParent !== null,
			run: async () => {
				if (context.newFolderParent) {
					await createFolderInFolder(context.newFolderParent);
				}
			},
		}),
		fromRegistry(
			"app.reveal",
			"File",
			["finder", "explorer", "show", "folder"],
			async () => {
				if (!path) return;
				try {
					await desktopApi.revealFile(path);
				} catch {
					toast.error("Failed to reveal file");
				}
			},
		),
		fromRegistry(
			"app.copy-path",
			"File",
			["clipboard", "location"],
			async () => {
				if (path) await copyText(path, "File path");
			},
		),
		fromRegistry(
			"app.copy-as-markdown",
			"File",
			["clipboard", "export", "source"],
			actions.requestCopyAsMarkdown,
			{ isEnabled: () => hasRichTextEditor(context) },
		),
		fromRegistry(
			"app.delete",
			"File",
			["remove", "trash"],
			async () => {
				if (!path) return;
				const name = basename(path);
				if (!window.confirm(`Delete ${name}?`)) return;
				await deleteMarkdownFile(path);
			},
			{
				destructive: true,
				globalShortcut: false,
				label: "Delete Note",
			},
		),

		// Navigate
		fromRegistry("app.go-back", "Navigate", ["history", "previous"], goBack),
		fromRegistry("app.go-forward", "Navigate", ["history", "next"], goForward),
		fromRegistry(
			"app.add-folder",
			"Navigate",
			["workspace", "vault", "directory", "open"],
			openWorkspaceWithSidebar,
		),
		fromRegistry(
			"app.open-folder",
			"Navigate",
			["workspace", "vault", "switch", "recent"],
			() => setWorkspaceSwitcherOpen(true),
		),
		paletteOnly({
			id: "app.toggle-pinned",
			label: context.isPinned ? "Unpin Note" : "Pin Note",
			group: "Navigate",
			keywords: ["favorite", "bookmark", "star"],
			isEnabled: () =>
				registry.hasCurrentFile === true && context.workspacePath !== null,
			run: async () => {
				if (path) await togglePinnedNote(path);
			},
		}),
		paletteOnly({
			id: "app.focus-sidebar",
			label: "Focus Sidebar",
			group: "Navigate",
			keywords: ["files", "tree", "explorer"],
			isEnabled: () => true,
			run: () => {
				setSidebarOpen(true);
				requestAnimationFrame(() => actions.focusSidebar());
			},
		}),

		// Editor
		// The link popover needs the selection that the palette takes focus from.
		editorCommand("editor.bold", "bold", ["strong", "format"]),
		editorCommand("editor.italic", "italic", ["emphasis", "format"]),
		editorCommand("editor.code", "code", ["monospace", "format"]),
		editorCommand("editor.strike", "strike", ["strikethrough", "format"]),
		editorCommand("editor.heading-1", "heading-1", ["title", "h1"]),
		editorCommand("editor.heading-2", "heading-2", ["subtitle", "h2"]),
		editorCommand("editor.heading-3", "heading-3", ["h3"]),
		editorCommand("editor.bullet-list", "bullet-list", [
			"unordered",
			"bullets",
		]),
		editorCommand("editor.ordered-list", "ordered-list", [
			"ordered",
			"numbers",
		]),
		editorCommand("editor.task-list", "task-list", [
			"todo",
			"checkbox",
			"checklist",
		]),
		editorCommand("editor.blockquote", "blockquote", ["quote", "citation"]),

		// View
		fromRegistry(
			"app.toggle-sidebar",
			"View",
			["files", "panel", "explorer"],
			toggleSidebar,
			{ label: context.sidebarOpen ? "Hide Sidebar" : "Show Sidebar" },
		),
		fromRegistry(
			"app.toggle-terminal",
			"View",
			["shell", "console", "command line"],
			toggleTerminal,
		),
		fromRegistry(
			"app.toggle-source-mode",
			"View",
			["markdown", "raw", "code"],
			() => setViewerMode(context.isSourceMode ? "rich" : "source"),
			{ label: context.isSourceMode ? "Edit Rich Text" : "Edit Source" },
		),
		paletteOnly({
			id: "view.toggle-theme",
			label: context.isDark ? "Switch to Light Theme" : "Switch to Dark Theme",
			group: "View",
			keywords: ["dark mode", "light mode", "appearance", "color"],
			isEnabled: () => true,
			run: () => setThemePreference(context.isDark ? "light" : "dark"),
		}),
		// Zoom bindings differ by platform, so they stay outside the registry.
		paletteOnly({
			id: "view.zoom-in",
			label: "Zoom In",
			group: "View",
			keywords: ["bigger", "larger", "text size"],
			binding: "CmdOrCtrl+=",
			globalShortcut: true,
			isEnabled: () => true,
			run: () => desktopApi.zoomWindow("in"),
		}),
		paletteOnly({
			id: "view.zoom-out",
			label: "Zoom Out",
			group: "View",
			keywords: ["smaller", "text size"],
			binding: "CmdOrCtrl+-",
			globalShortcut: true,
			isEnabled: () => true,
			run: () => desktopApi.zoomWindow("out"),
		}),
		paletteOnly({
			id: "view.zoom-reset",
			label: "Reset Zoom",
			group: "View",
			keywords: ["actual size", "default"],
			binding: "CmdOrCtrl+0",
			globalShortcut: true,
			isEnabled: () => true,
			run: () => desktopApi.zoomWindow("reset"),
		}),

		// App
		fromRegistry(
			"app.settings",
			"App",
			["preferences", "options", "config"],
			actions.openSettings,
		),
		fromRegistry(
			"app.chat-about-note",
			"App",
			["agent", "ai", "claude", "codex", "terminal"],
			requestChatAboutNote,
		),
		paletteOnly({
			id: "app.check-for-updates",
			label: "Check for Updates",
			group: "App",
			keywords: ["upgrade", "version", "release"],
			isEnabled: () => true,
			run: async () => {
				try {
					await desktopApi.checkForUpdates();
				} catch (error) {
					toast.error("Failed to check for updates", {
						description: error instanceof Error ? error.message : String(error),
					});
				}
			},
		}),
		paletteOnly({
			id: "app.whats-new",
			label: "What's New",
			group: "App",
			keywords: ["changelog", "release notes", "updates"],
			isEnabled: () => true,
			run: async () => {
				await openChangelog();
			},
		}),
		paletteOnly({
			id: "app.contributing",
			label: "Open Contributing Guide",
			group: "App",
			keywords: ["docs", "help", "github", "open source"],
			isEnabled: () => true,
			run: () => desktopApi.openExternalUrl(CONTRIBUTING_URL),
		}),
	];
}

export function buildAppCommands(
	actions: AppCommandActions,
	context: AppCommandContext,
): PaletteCommand[] {
	return defineCommands(actions, context)
		.filter((command) => command.isEnabled())
		.map(({ isEnabled: _isEnabled, binding, ...command }) => ({
			...command,
			binding,
			shortcut: binding ? formatShortcut(binding) : undefined,
		}));
}
