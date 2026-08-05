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
import { isEditableFile } from "../lib/filePath";
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

/**
 * App state the palette needs, beyond what the registry's `CommandContext`
 * already covers.
 *
 * The extra fields exist only to label toggles by what they will *do* — "Hide
 * Sidebar" rather than "Toggle Sidebar" — so a user reading the list does not
 * have to know the current state to predict the outcome.
 */
export type AppCommandContext = {
	currentPath: string | null;
	workspacePath: string | null;
	isSourceMode: boolean;
	sidebarOpen: boolean;
	isDark: boolean;
	isPinned: boolean;
};

/**
 * Side effects the palette cannot reach on its own, because they live in
 * `App`'s React state rather than in the store.
 */
export type AppCommandActions = {
	openSettings: () => void;
	requestCopyAsMarkdown: () => void;
	focusSidebar: () => void;
};

/** The subset of app state the registry's own predicates read. */
function toRegistryContext(context: AppCommandContext): RegistryContext {
	const path = context.currentPath;
	const isRealFile = path !== null && !isChangelogPath(path);
	return {
		hasCurrentFile: isRealFile,
		hasEditableFile: isRealFile && isEditableFile(path),
		hasWorkspace: context.workspacePath !== null,
		isSourceMode: context.isSourceMode,
		canGoBack: canGoBack(),
		canGoForward: canGoForward(),
	};
}

/** Rich text is being edited, so an editor command has somewhere to land. */
function hasRichTextEditor(context: AppCommandContext) {
	const registry = toRegistryContext(context);
	return registry.hasEditableFile === true && !context.isSourceMode;
}

type Declaration = Omit<PaletteCommand, "binding" | "shortcut"> & {
	binding?: string;
	isEnabled: () => boolean;
};

function defineCommands(
	actions: AppCommandActions,
	context: AppCommandContext,
): Declaration[] {
	const path = context.currentPath;
	const registry = toRegistryContext(context);

	/**
	 * Projects a registry entry into a palette row.
	 *
	 * Label, binding, and enablement come from the registry so the palette can
	 * never disagree with the menu bar or the key handler about what a command
	 * is called, what it is bound to, or when it applies. Only the palette's own
	 * concerns — grouping, search synonyms, and the handler — are supplied here.
	 *
	 * `label` is overridden only for toggles, which the registry names by the
	 * toggle rather than by the outcome.
	 */
	const fromRegistry = (
		id: CommandId,
		group: string,
		keywords: string[],
		run: () => void | Promise<void>,
		options?: {
			destructive?: boolean;
			label?: string;
			isEnabled?: () => boolean;
		},
	): Declaration => {
		const command = getCommand(id);
		return {
			id,
			label: options?.label ?? command.label,
			group,
			keywords,
			binding: command.defaultBinding,
			destructive: options?.destructive,
			isEnabled: options?.isEnabled ?? (() => command.isEnabled(registry)),
			run,
		};
	};

	/** A palette-only action: real behavior, but no registry entry or binding. */
	const local = (declaration: Declaration): Declaration => declaration;

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
				runEditorAction(action);
			},
			{
				// Registry editor commands are `always` enabled because the keymap only
				// fires inside the editor. The palette has no such guard, so it adds one.
				isEnabled: () => hasRichTextEditor(context),
			},
		);

	return [
		// ---- File ----
		fromRegistry("app.new-file", "File", ["create", "markdown", "note"], () =>
			createMarkdownFile(),
		),
		local({
			id: "app.new-folder",
			label: "New Folder",
			group: "File",
			keywords: ["create", "directory"],
			isEnabled: () => context.workspacePath !== null,
			run: async () => {
				if (context.workspacePath) {
					await createFolderInFolder(context.workspacePath);
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
		),
		fromRegistry(
			"app.delete",
			"File",
			["remove", "trash"],
			async () => {
				if (!path) return;
				const name = path.split("/").pop() ?? path;
				// Matches the sidebar's confirm rather than introducing a second
				// deletion flow. A palette is easy to trigger by accident, and the
				// undo toast that follows is a safety net, not a substitute.
				if (!window.confirm(`Delete ${name}?`)) return;
				await deleteMarkdownFile(path);
			},
			{ destructive: true, label: "Delete Note" },
		),

		// ---- Navigate ----
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
		local({
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
		local({
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

		// ---- Editor ----
		// `editor.link` is omitted: it opens the link popover, which needs the
		// selection the palette has just taken focus from.
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

		// ---- View ----
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
		local({
			id: "view.toggle-theme",
			label: context.isDark ? "Switch to Light Theme" : "Switch to Dark Theme",
			group: "View",
			keywords: ["dark mode", "light mode", "appearance", "color"],
			isEnabled: () => true,
			run: () => setThemePreference(context.isDark ? "light" : "dark"),
		}),
		// Zoom stays out of the registry by design (#193: OS convention, and `=`
		// vs `+` differs per platform), so these carry their own hint strings.
		local({
			id: "view.zoom-in",
			label: "Zoom In",
			group: "View",
			keywords: ["bigger", "larger", "text size"],
			binding: "CmdOrCtrl+=",
			isEnabled: () => true,
			run: () => desktopApi.zoomWindow("in"),
		}),
		local({
			id: "view.zoom-out",
			label: "Zoom Out",
			group: "View",
			keywords: ["smaller", "text size"],
			binding: "CmdOrCtrl+-",
			isEnabled: () => true,
			run: () => desktopApi.zoomWindow("out"),
		}),
		local({
			id: "view.zoom-reset",
			label: "Reset Zoom",
			group: "View",
			keywords: ["actual size", "default"],
			binding: "CmdOrCtrl+0",
			isEnabled: () => true,
			run: () => desktopApi.zoomWindow("reset"),
		}),

		// ---- App ----
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
		local({
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
		local({
			id: "app.whats-new",
			label: "What's New",
			group: "App",
			keywords: ["changelog", "release notes", "updates"],
			isEnabled: () => true,
			run: async () => {
				await openChangelog();
			},
		}),
		local({
			id: "app.contributing",
			label: "Open Contributing Guide",
			group: "App",
			keywords: ["docs", "help", "github", "open source"],
			isEnabled: () => true,
			run: () => desktopApi.openExternalUrl(CONTRIBUTING_URL),
		}),
	];
}

/**
 * Builds the palette's command list for the current context.
 *
 * Disabled commands are dropped rather than greyed out: a palette is a search
 * surface, and a result you can select but not run reads as a bug. The menu bar
 * still shows them disabled, which is where discoverability of *unavailable*
 * actions belongs.
 */
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
