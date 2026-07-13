import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hubbleRuntime from "@hubble.md/runtime/global.js?raw";
import htmlAppTheme from "@hubble.md/runtime/html-app-theme.css?raw";
import tailwindRuntime from "@tailwindcss/browser?raw";
import alpineRuntime from "alpinejs/dist/cdn.min.js?raw";
import chokidar, { type FSWatcher } from "chokidar";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeTheme,
	protocol,
	screen,
	shell,
} from "electron";
import electronUpdater from "electron-updater";
import ignore from "ignore";
import { z } from "zod/v4";
import type {
	DesktopUpdateState,
	DirectoryListing,
	MenuState,
	SearchFileResult,
	WorkspaceConfig,
} from "../src/desktopApi/types";
import {
	hasDocumentExtension,
	hasMarkdownExtension,
	isHiddenSidebarFolderName,
	markdownAssetFolderPath,
	withMarkdownExtension,
} from "../src/lib/filePath";
import {
	findMatchesInContent,
	SEARCH_CONCURRENCY,
	SEARCH_MAX_FILE_BYTES,
	SEARCH_MAX_RESULT_FILES,
	SEARCH_MIN_QUERY_LENGTH,
} from "../src/lib/searchContent";
import { setupTerminalIpc } from "./terminal";
import {
	loadZoomFactor,
	resetWindowZoom,
	setTrafficLightInset,
	stepWindowZoom,
	trafficLightPositionForZoom,
	zoomStep,
} from "./zoom";

type HtmlAppFileEntry = {
	name: string;
	path: string;
	modified_at: number;
	size: number;
};

type IgnoreRule = {
	dir: string;
	matcher: ReturnType<typeof ignore>;
};

type HtmlAppAsset = {
	name: string;
	source: string;
};

type WindowState = {
	width: number;
	height: number;
	x?: number;
	y?: number;
	isMaximized?: boolean;
	isFullScreen?: boolean;
};

type WindowBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const isDev = !app.isPackaged || process.env.HUBBLE_DESKTOP_FORCE_DEV === "1";
const { autoUpdater } = electronUpdater;
const devAppName = isDev ? process.env.HUBBLE_DESKTOP_DEV_APP_NAME : undefined;
const appName = devAppName ?? "Hubble";
const debugPort = process.env.HUBBLE_DESKTOP_DEBUG_PORT ?? "9222";
const updateFeedUrl = process.env.HUBBLE_DESKTOP_UPDATE_URL;
const supportsAutoUpdates = !isDev && process.platform === "darwin";
const updateCheckErrorMessage =
	"Couldn't check for updates. Try again shortly.";
// Check every 4 hours after the initial packaged-app update check.
const updateCheckIntervalMs = 4 * 60 * 60 * 1000;

// Follow the OS appearance. The renderer mirrors this to a `.dark` class so the
// class-based Tailwind dark variant and `.dark { … }` token block activate.
nativeTheme.themeSource = "system";

// Windows/Linux draw the min/max/close buttons as a native overlay whose colors
// are static unless we update them. Mirror the app palette so the button strip
// follows the OS appearance instead of staying light in dark mode.
function titleBarOverlayColors() {
	return nativeTheme.shouldUseDarkColors
		? { color: "#181715", symbolColor: "#a6a5a0" }
		: { color: "#ffffff", symbolColor: "#454545" };
}

app.setName(appName);
if (devAppName) {
	app.setPath("userData", path.join(app.getPath("appData"), devAppName));
}

if (isDev && process.env.HUBBLE_DESKTOP_ENABLE_CDP === "1") {
	app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
	app.commandLine.appendSwitch("remote-debugging-port", debugPort);
}

let mainWindow: BrowserWindow | null = null;
let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null;

// Repaint the native window-control overlay when the OS appearance changes so it
// tracks the live theme switch (macOS manages its traffic lights itself).
if (process.platform !== "darwin") {
	nativeTheme.on("updated", () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.setTitleBarOverlay(titleBarOverlayColors());
		}
	});
}
let pendingOpenPath: string | null = firstExistingFileArg(
	process.argv.slice(1),
);
const launchWorkspacePath =
	isDev && process.env.HUBBLE_DESKTOP_DEV_WORKSPACE
		? resolvePath(process.env.HUBBLE_DESKTOP_DEV_WORKSPACE)
		: null;
let menuState: MenuState = {
	hasWorkspace: false,
	hasMarkdownNoteOpen: false,
	isSourceMode: false,
	canGoBack: false,
	canGoForward: false,
};
let updateState: DesktopUpdateState = {
	isSupported: supportsAutoUpdates,
	status: "idle",
	currentVersion: app.getVersion(),
	availableVersion: null,
	progressPercent: null,
	message: supportsAutoUpdates
		? null
		: "Updates are available on packaged macOS builds only.",
	lastCheckedAt: null,
};
const watchers = new Map<string, FSWatcher>();
const grantedFiles = new Set<string>();
const grantedRoots = new Set<string>();
let grantsLoaded = false;
// An AbortSignal cannot cross IPC, so a superseded search is abandoned by
// comparing its id against the newest one between files.
let latestSearchRequestId = 0;

const ignoreConfigFiles = [".gitignore", ".ignore"];
const ignoredWorkspaceDirs = new Set([".git", "dist", "node_modules"]);
const workspaceConfigVersion = 1;
const workspaceConfigDir = ".hubble";
const workspaceConfigFile = "config.json";
const workspaceConfigSchema = z.object({
	version: z.literal(workspaceConfigVersion),
	pinnedNotes: z.array(
		z
			.string()
			.min(1)
			// Pin refs live inside the workspace config; reject absolute paths and
			// traversal so config edits cannot point pin state outside the workspace.
			.refine(
				(note) => !path.isAbsolute(note) && !note.split("/").includes(".."),
			),
	),
});
const defaultWindowState: WindowState = { width: 920, height: 720 };
const windowStateSchema = z.object({
	width: z.number().int().min(640).max(4096),
	height: z.number().int().min(480).max(4096),
	x: z.number().int().optional(),
	y: z.number().int().optional(),
	isMaximized: z.boolean().optional(),
	isFullScreen: z.boolean().optional(),
});
const htmlAppHeadStyles = [
	{ name: "hubble-theme", source: htmlAppTheme },
] as const;
const htmlAppHeadScripts = [
	{ name: "hubble-runtime", source: hubbleRuntime },
	{ name: "tailwind-browser", source: tailwindRuntime },
] as const;
// Alpine's CDN build auto-starts immediately; inline scripts cannot use defer.
const htmlAppBodyEndScripts = [
	{ name: "alpine", source: alpineRuntime },
] as const;

function grantsPath(): string {
	return path.join(app.getPath("userData"), "grants.json");
}

function windowStatePath(): string {
	return path.join(app.getPath("userData"), "window-size.json");
}

function workspaceConfigPath(workspacePath: string): string {
	const root = assertGrantedRoot(workspacePath);
	return path.join(root, workspaceConfigDir, workspaceConfigFile);
}

function emptyWorkspaceConfig(): WorkspaceConfig {
	return { version: workspaceConfigVersion, pinnedNotes: [] };
}

function parseWorkspaceConfig(raw: string): WorkspaceConfig {
	try {
		return workspaceConfigSchema.parse(JSON.parse(raw));
	} catch {
		return emptyWorkspaceConfig();
	}
}

function normalizeWorkspaceConfig(input: WorkspaceConfig): WorkspaceConfig {
	const config = workspaceConfigSchema.safeParse(input);
	if (!config.success) return emptyWorkspaceConfig();
	return {
		version: workspaceConfigVersion,
		pinnedNotes: [...new Set(config.data.pinnedNotes)],
	};
}

async function loadGrants() {
	try {
		const raw = await fs.readFile(grantsPath(), "utf8");
		const parsed = JSON.parse(raw) as { files?: unknown; roots?: unknown };
		if (Array.isArray(parsed.files)) {
			for (const filePath of parsed.files) {
				if (typeof filePath === "string")
					grantedFiles.add(resolvePath(filePath));
			}
		}
		if (Array.isArray(parsed.roots)) {
			for (const rootPath of parsed.roots) {
				if (typeof rootPath === "string")
					grantedRoots.add(resolvePath(rootPath));
			}
		}
	} catch {
		// Missing or malformed grants just means the user must pick paths again.
	} finally {
		grantsLoaded = true;
	}
}

async function saveGrants() {
	if (!grantsLoaded) return;
	await fs.mkdir(path.dirname(grantsPath()), { recursive: true });
	await fs.writeFile(
		grantsPath(),
		JSON.stringify(
			{
				files: [...grantedFiles],
				roots: [...grantedRoots],
			},
			null,
			2,
		),
	);
}

async function loadWindowState(): Promise<WindowState> {
	try {
		const raw = await fs.readFile(windowStatePath(), "utf8");
		const parsed = windowStateSchema.safeParse(JSON.parse(raw));
		if (parsed.success) return resolveWindowState(parsed.data);
	} catch {
		// Missing or malformed window state should not block launch.
	}
	return defaultWindowState;
}

function resolveWindowState(state: WindowState): WindowState {
	if (
		state.x === undefined ||
		state.y === undefined ||
		!isVisibleWindowBounds({
			x: state.x,
			y: state.y,
			width: state.width,
			height: state.height,
		})
	) {
		return {
			...clampWindowSize(state, screen.getPrimaryDisplay().workArea),
			isMaximized: state.isMaximized,
			isFullScreen: state.isFullScreen,
		};
	}
	const bounds = {
		x: state.x,
		y: state.y,
		width: state.width,
		height: state.height,
	};
	return {
		...state,
		...clampWindowBounds(bounds, screen.getDisplayMatching(bounds).workArea),
	};
}

function clampWindowSize(
	{ width, height }: Pick<WindowState, "width" | "height">,
	workArea: { width: number; height: number },
) {
	return {
		width: Math.min(width, workArea.width),
		height: Math.min(height, workArea.height),
	};
}

function clampWindowBounds(bounds: WindowBounds, workArea: WindowBounds) {
	const size = clampWindowSize(bounds, workArea);
	return {
		...size,
		x: Math.min(
			Math.max(bounds.x, workArea.x),
			workArea.x + workArea.width - size.width,
		),
		y: Math.min(
			Math.max(bounds.y, workArea.y),
			workArea.y + workArea.height - size.height,
		),
	};
}

function isVisibleWindowBounds(bounds: WindowBounds) {
	return screen.getAllDisplays().some(({ workArea }) => {
		const visibleWidth =
			Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
			Math.max(bounds.x, workArea.x);
		const visibleHeight =
			Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
			Math.max(bounds.y, workArea.y);
		return (
			visibleWidth >= Math.min(160, bounds.width) &&
			visibleHeight >= Math.min(120, bounds.height)
		);
	});
}

function saveWindowState(window: BrowserWindow) {
	if (window.isDestroyed() || window.isMinimized()) return;
	const bounds = window.getNormalBounds();
	const parsed = windowStateSchema.safeParse({
		...bounds,
		isMaximized: window.isMaximized(),
		isFullScreen: window.isFullScreen(),
	});
	if (!parsed.success) return;
	try {
		fsSync.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
		fsSync.writeFileSync(
			windowStatePath(),
			JSON.stringify(parsed.data, null, 2),
		);
	} catch {
		// Best-effort window state should not interrupt resize or app shutdown.
	}
}

function queueSaveWindowState(window: BrowserWindow) {
	if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
	saveWindowStateTimer = setTimeout(() => {
		saveWindowStateTimer = null;
		saveWindowState(window);
	}, 300);
}

function resolvePath(input: string): string {
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new Error("Path is required");
	}
	if (input === "~") return app.getPath("home");
	if (input.startsWith("~/") || input.startsWith("~\\")) {
		return path.resolve(app.getPath("home"), input.slice(2));
	}
	// Asset and workspace paths can arrive POSIX-style with a leading slash
	// before the drive letter (e.g. "/C:/notes" from the forward-slash asset
	// URLs HTML Apps use as their base). On Windows path.resolve would treat
	// that as drive-relative and prepend the current drive ("C:\C:\notes"),
	// breaking the granted-scope check, so strip the leading slash first.
	const normalized =
		process.platform === "win32"
			? input.replace(/^[\\/]+([A-Za-z]:)/, "$1")
			: input;
	return path.resolve(normalized);
}

function grantFile(filePath: string) {
	grantedFiles.add(resolvePath(filePath));
	void saveGrants();
}

function grantRoot(rootPath: string) {
	grantedRoots.add(resolvePath(rootPath));
	void saveGrants();
}

function grantFileWithParent(filePath: string) {
	const resolved = resolvePath(filePath);
	grantFile(resolved);
	grantRoot(path.dirname(resolved));
}

function isWithin(rootPath: string, candidatePath: string): boolean {
	const relative = path.relative(rootPath, candidatePath);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

/** Covers always-ignored workspace dirs in case Git ignores do not catch them. */
function isIgnoredWorkspacePath(candidatePath: string): boolean {
	return candidatePath
		.split(/[\\/]+/)
		.some((segment) => ignoredWorkspaceDirs.has(segment));
}

function toIgnorePath(input: string): string {
	return input.split(path.sep).join("/");
}

/**
 * Paths sent to the renderer always use forward slashes so the UI's path
 * helpers (relative/absolute joins, prefix checks) stay consistent across
 * platforms. On Windows the OS-native separator is a backslash, which otherwise
 * mixes with the forward-slash paths the renderer builds and produces doubled
 * paths like "C:\\ws/C:/ws/new-file.md".
 */
function toRendererPath(input: string): string {
	return input.split(path.sep).join("/");
}

function isIgnoredByRules(candidatePath: string, rules: IgnoreRule[]) {
	if (isIgnoredWorkspacePath(candidatePath)) return true;

	let ignored = false;
	for (const { dir, matcher } of rules) {
		const relative = path.relative(dir, candidatePath);
		if (
			relative === "" ||
			relative.startsWith("..") ||
			path.isAbsolute(relative)
		)
			continue;
		const ignorePath = toIgnorePath(relative);
		const result = matcher.test(ignorePath);
		const directoryResult = matcher.test(`${ignorePath}/`);
		if (result.ignored || directoryResult.ignored) ignored = true;
		if (result.unignored || directoryResult.unignored) ignored = false;
	}
	return ignored;
}

function isDocumentPath(candidatePath: string): boolean {
	return hasDocumentExtension(candidatePath);
}

function isMissingPathError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

async function rulesForDir(dir: string, inherited: IgnoreRule[]) {
	const matcher = ignore();
	let hasRules = false;

	for (const fileName of ignoreConfigFiles) {
		try {
			matcher.add(await fs.readFile(path.join(dir, fileName), "utf8"));
			hasRules = true;
		} catch (error) {
			if (isMissingPathError(error)) continue;
			throw error;
		}
	}

	return hasRules ? [...inherited, { dir, matcher }] : inherited;
}

function assertGranted(input: string): string {
	const resolved = resolvePath(input);
	if (grantedFiles.has(resolved)) return resolved;
	for (const root of grantedRoots) {
		if (isWithin(root, resolved)) return resolved;
	}
	throw new Error(`Path is outside granted scope: ${input}`);
}

function assertGrantedRoot(input: string): string {
	const resolved = assertGranted(input);
	grantRoot(resolved);
	return resolved;
}

async function pathExistsAsFile(input: string): Promise<boolean> {
	try {
		return (await fs.stat(input)).isFile();
	} catch {
		return false;
	}
}

async function pathExists(input: string): Promise<boolean> {
	try {
		await fs.stat(input);
		return true;
	} catch {
		return false;
	}
}

async function assertGrantedOrConfirmFile(filePath: string): Promise<string> {
	try {
		return assertGranted(filePath);
	} catch {
		const resolved = resolvePath(filePath);
		const result = await dialog.showMessageBox(mainWindow ?? undefined, {
			type: "question",
			buttons: ["Open", "Cancel"],
			defaultId: 0,
			cancelId: 1,
			message: "Open file outside workspace?",
			detail: resolved,
		});
		if (result.response !== 0) throw new Error("Open cancelled");
		grantFileWithParent(resolved);
		return resolved;
	}
}

// HUBBLE_SKILL_DIR_NAMES tracks the skill folders in
// github.com/bholmesdev/hubble-skills and must be updated if those skills are
// renamed; the /hubble/ substring match is a resilient fallback.
const HUBBLE_SKILL_DIR_NAMES = ["create-html-app", "embed-html-app"];

async function skillsDirHasHubble(dirPath: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(dirPath);
		return entries.some((name) => {
			const lower = name.toLocaleLowerCase();
			return HUBBLE_SKILL_DIR_NAMES.includes(lower) || lower.includes("hubble");
		});
	} catch {
		return false;
	}
}

/**
 * Detects Hubble skills across the workspace and the user's global agent
 * folders. Runs in the main process because the global paths live outside the
 * renderer's granted file scope. Fast and ENOENT-quiet: every location is probed
 * in parallel and missing paths resolve to false.
 */
async function detectHubbleSkills(workspacePath: unknown): Promise<boolean> {
	const workspace = typeof workspacePath === "string" ? workspacePath : null;
	const roots = workspace ? [os.homedir(), workspace] : [os.homedir()];
	const skillDirs = roots.flatMap((root) => [
		path.join(root, ".claude", "skills"),
		path.join(root, ".agents", "skills"),
	]);

	const results = await Promise.all(skillDirs.map(skillsDirHasHubble));
	return results.some(Boolean);
}

function firstExistingFileArg(args: string[]): string | null {
	for (const arg of args) {
		if (arg.startsWith("-")) continue;
		const resolved = path.resolve(arg);
		try {
			if (fsSync.statSync(resolved).isFile()) {
				grantFileWithParent(resolved);
				return resolved;
			}
		} catch {
			// Keep scanning.
		}
	}
	return null;
}

function sendToRenderer(channel: string, ...args: unknown[]) {
	mainWindow?.webContents.send(channel, ...args);
}

function assetPathFromUrl(url: URL): string {
	const queryPath = url.searchParams.get("path");
	if (queryPath) return queryPath;
	const encodedPath = url.pathname.startsWith("/")
		? url.pathname.slice(1)
		: url.pathname;
	return decodeURIComponent(encodedPath);
}

function assetContentType(filePath: string): string {
	switch (path.extname(filePath).toLowerCase()) {
		case ".css":
			return "text/css; charset=utf-8";
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
		case ".mjs":
			return "text/javascript; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}

function scriptTag({ name, source }: HtmlAppAsset) {
	return `<script data-hubble-injected="${name}">\n${source}\n</script>`;
}

function styleTag({ name, source }: HtmlAppAsset) {
	return `<style data-hubble-injected="${name}" type="text/tailwindcss">\n${source}\n</style>`;
}

function insertBeforeCloseTag(html: string, tagName: string, content: string) {
	const closeIndex = html.search(new RegExp(`</${tagName}\\s*>`, "i"));
	if (closeIndex === -1) return `${html}${content}`;
	return `${html.slice(0, closeIndex)}${content}${html.slice(closeIndex)}`;
}

function injectHtmlAppRuntime(html: string): string {
	const headStyles = htmlAppHeadStyles.map(styleTag).join("\n");
	const headScripts = htmlAppHeadScripts.map(scriptTag).join("\n");
	const bodyEndScripts = htmlAppBodyEndScripts.map(scriptTag).join("\n");
	const headInjection = `\n${headStyles}\n${headScripts}\n`;
	const bodyEndInjection = `\n${bodyEndScripts}\n`;
	const withHead =
		html.search(/<\/head\s*>/i) === -1
			? `${headInjection}${html}`
			: insertBeforeCloseTag(html, "head", headInjection);
	return insertBeforeCloseTag(withHead, "body", bodyEndInjection);
}

function responseForAsset(filePath: string) {
	const contentType = assetContentType(filePath);
	const body = contentType.startsWith("text/html")
		? injectHtmlAppRuntime(fsSync.readFileSync(filePath, "utf8"))
		: fsSync.readFileSync(filePath);

	return new Response(body, {
		headers: {
			"cache-control": "no-store",
			"content-type": contentType,
		},
	});
}

type TextContextMenuItem =
	| {
			role: "cut" | "copy" | "paste" | "selectAll";
			flag: keyof Electron.EditFlags;
	  }
	| {
			id: "copy-as-markdown";
			label: string;
			accelerator?: string;
			flag: keyof Electron.EditFlags;
			click: (webContents: Electron.WebContents) => void;
	  };

const textContextMenuItems: TextContextMenuItem[] = [
	{ role: "cut", flag: "canCut" },
	{ role: "copy", flag: "canCopy" },
	{
		id: "copy-as-markdown",
		label: "Copy as Markdown",
		accelerator: "Alt+CmdOrCtrl+C",
		flag: "canCopy",
		click: (webContents) => {
			webContents.send("desktop:menu-copy-as-markdown");
		},
	},
	{ role: "paste", flag: "canPaste" },
	{ role: "selectAll", flag: "canSelectAll" },
];

function buildTextContextMenu(
	webContents: Electron.WebContents,
	params: Electron.ContextMenuParams,
) {
	const spellingItems: Electron.MenuItemConstructorOptions[] =
		params.misspelledWord.length > 0
			? [
					...(params.dictionarySuggestions.length > 0
						? params.dictionarySuggestions.map((suggestion) => ({
								label: suggestion,
								click: () => webContents.replaceMisspelling(suggestion),
							}))
						: [{ label: "No Guesses Found", enabled: false }]),
					{
						label: "Add to Dictionary",
						click: () =>
							webContents.session.addWordToSpellCheckerDictionary(
								params.misspelledWord,
							),
					},
					{ type: "separator" },
				]
			: [];

	// In source mode the text is already markdown, so plain copy covers it.
	const editItems: Electron.MenuItemConstructorOptions[] = textContextMenuItems
		.filter(
			(item) =>
				!(
					menuState.isSourceMode &&
					"id" in item &&
					item.id === "copy-as-markdown"
				),
		)
		.map((item) =>
			"role" in item
				? {
						role: item.role,
						enabled: params.editFlags[item.flag],
					}
				: {
						id: item.id,
						label: item.label,
						accelerator: item.accelerator,
						enabled: params.editFlags[item.flag],
						click: () => item.click(webContents),
					},
		);

	return Menu.buildFromTemplate([...spellingItems, ...editItems]);
}

function registerTextContextMenu(window: BrowserWindow) {
	window.webContents.on("context-menu", (_event, params) => {
		if (!params.isEditable) return;
		buildTextContextMenu(window.webContents, params).popup({
			window,
			// macOS needs the originating frame to attach Writing Tools and text services.
			frame: params.frame ?? undefined,
		});
	});
}

function buildMenu() {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: "File",
			submenu: [
				{
					id: "new-markdown-file",
					label: "New File",
					accelerator: "CmdOrCtrl+N",
					click: () => sendToRenderer("desktop:menu-create-markdown-file"),
				},
				{
					id: "new-html-file",
					label: "New HTML App",
					click: () => sendToRenderer("desktop:menu-create-html-file"),
				},
				{
					id: "new-workspace",
					label: "Add Folder...",
					accelerator: "CmdOrCtrl+Shift+N",
					click: () => sendToRenderer("desktop:menu-open-folder"),
				},
				{ type: "separator" },
				{
					id: "open",
					label: "Open...",
					accelerator: "CmdOrCtrl+O",
					click: () => sendToRenderer("desktop:menu-open-file"),
				},
				{
					id: "open-workspace",
					label: "Open Folder...",
					accelerator: "CmdOrCtrl+Shift+O",
					enabled: menuState.hasWorkspace,
					click: () => sendToRenderer("desktop:menu-show-workspace-switcher"),
				},
				{ type: "separator" },
				{
					id: "go-to-file",
					label: "Go to File...",
					accelerator: "CmdOrCtrl+P",
					enabled: menuState.hasWorkspace,
					click: () => sendToRenderer("desktop:menu-go-to-file"),
				},
				{ type: "separator" },
				{
					id: "sync-workspace",
					label: "Sync Workspace",
					enabled: menuState.hasWorkspace,
					click: () => sendToRenderer("desktop:menu-sync-workspace"),
				},
				{ type: "separator" },
				{ role: "close" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{
					id: "copy-as-markdown",
					label: "Copy as Markdown",
					accelerator: "Alt+CmdOrCtrl+C",
					enabled: !menuState.isSourceMode,
					click: () => sendToRenderer("desktop:menu-copy-as-markdown"),
				},
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{
					id: "go-back",
					label: "Go Back",
					accelerator: "CmdOrCtrl+[",
					enabled: menuState.canGoBack,
					click: () => sendToRenderer("desktop:menu-go-back"),
				},
				{
					id: "go-forward",
					label: "Go Forward",
					accelerator: "CmdOrCtrl+]",
					enabled: menuState.canGoForward,
					click: () => sendToRenderer("desktop:menu-go-forward"),
				},
				{ type: "separator" },
				{
					id: "zoom-in",
					label: "Zoom In",
					accelerator: "CmdOrCtrl+=",
					click: () => stepWindowZoom(mainWindow, zoomStep),
				},
				{
					id: "zoom-out",
					label: "Zoom Out",
					accelerator: "CmdOrCtrl+-",
					click: () => stepWindowZoom(mainWindow, -zoomStep),
				},
				{
					id: "reset-zoom",
					label: "Reset Zoom",
					accelerator: "CmdOrCtrl+0",
					click: () => resetWindowZoom(mainWindow),
				},
				{ type: "separator" },
				{
					id: "toggle-terminal",
					label: "Toggle Terminal",
					accelerator: "CmdOrCtrl+J",
					enabled: menuState.hasWorkspace,
					click: () => sendToRenderer("desktop:menu-toggle-terminal"),
				},
				{
					id: "toggle-source-mode",
					label: "Toggle Source Mode",
					accelerator: "Alt+CmdOrCtrl+U",
					enabled: menuState.hasMarkdownNoteOpen,
					click: () => sendToRenderer("desktop:menu-toggle-source-mode"),
				},
				...(isDev
					? ([
							{ type: "separator" },
							{ role: "reload" },
							{ role: "forceReload" },
							{ type: "separator" },
							{ role: "toggleDevTools" },
						] satisfies Electron.MenuItemConstructorOptions[])
					: []),
			],
		},
		{
			label: "Help",
			submenu: [
				{
					id: "whats-new",
					label: "See what's new",
					click: () => sendToRenderer("desktop:menu-open-changelog"),
				},
			],
		},
	];

	if (process.platform === "darwin") {
		template.unshift({
			label: app.name,
			submenu: [
				{
					id: "settings",
					label: "Settings...",
					accelerator: "CmdOrCtrl+,",
					click: () => sendToRenderer("desktop:menu-open-settings"),
				},
				{ type: "separator" },
				{
					id: "check-for-updates",
					label: "Check for Updates...",
					click: () => sendToRenderer("desktop:menu-open-settings"),
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function syncUpdateState(nextState: DesktopUpdateState) {
	updateState = nextState;
	buildMenu();
	sendToRenderer("desktop:update-state", updateState);
}

function patchUpdateState(patch: Partial<DesktopUpdateState>) {
	syncUpdateState({
		...updateState,
		...patch,
	});
}

async function checkForUpdates() {
	if (!supportsAutoUpdates) {
		patchUpdateState({
			status: "idle",
			message: "Updates are available on packaged macOS builds only.",
		});
		return;
	}
	if (
		updateState.status === "checking" ||
		updateState.status === "downloading" ||
		updateState.status === "ready"
	) {
		return;
	}
	patchUpdateState({
		status: "checking",
		progressPercent: null,
		message: null,
	});
	try {
		await autoUpdater.checkForUpdates();
	} catch (error) {
		console.error("Auto-update check failed", error);
		patchUpdateState({
			status: "error",
			message: updateCheckErrorMessage,
			lastCheckedAt: Date.now(),
		});
	}
}

function configureAutoUpdates() {
	if (!supportsAutoUpdates) return;
	if (updateFeedUrl) {
		autoUpdater.setFeedURL({
			provider: "generic",
			url: updateFeedUrl,
		});
	}
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("update-available", (info) => {
		patchUpdateState({
			status: "downloading",
			availableVersion: info.version ?? null,
			progressPercent: 0,
			message: "Downloading update...",
			lastCheckedAt: Date.now(),
		});
	});
	autoUpdater.on("update-not-available", () => {
		patchUpdateState({
			status: "up-to-date",
			availableVersion: null,
			progressPercent: null,
			message: "Hubble is up to date.",
			lastCheckedAt: Date.now(),
		});
	});
	autoUpdater.on("download-progress", (progress) => {
		patchUpdateState({
			status: "downloading",
			progressPercent: progress.percent,
			message: "Downloading update...",
		});
	});
	autoUpdater.on("update-downloaded", (info) => {
		patchUpdateState({
			status: "ready",
			availableVersion: info.version ?? updateState.availableVersion,
			progressPercent: 100,
			message: "Restart Hubble to install the update.",
			lastCheckedAt: Date.now(),
		});
	});
	autoUpdater.on("error", (error) => {
		console.error("Auto-update error", error);
		patchUpdateState({
			status: "error",
			message: updateCheckErrorMessage,
			lastCheckedAt: Date.now(),
		});
	});

	void checkForUpdates();
	setInterval(() => {
		void checkForUpdates();
	}, updateCheckIntervalMs);
}

function extensionFromImage(
	bytes: Uint8Array,
	mimeType: string | null,
): string {
	const mime = mimeType?.trim().toLowerCase() ?? "";
	if (mime.includes("png")) return "png";
	if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
	if (mime.includes("webp")) return "webp";
	if (mime.includes("gif")) return "gif";
	if (mime.includes("bmp")) return "bmp";
	if (mime.includes("svg")) return "svg";

	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return "png";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "jpg";
	}
	if (Buffer.from(bytes.subarray(0, 6)).toString() === "GIF87a") return "gif";
	if (Buffer.from(bytes.subarray(0, 6)).toString() === "GIF89a") return "gif";
	if (
		bytes.length >= 12 &&
		Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
		Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP"
	) {
		return "webp";
	}
	if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
	return "png";
}

function fileAssetsDir(filePath: string): string {
	const assetsDir = markdownAssetFolderPath(filePath);
	if (!assetsDir) throw new Error(`Unable to resolve file name: ${filePath}`);
	return assetsDir;
}

async function collectDocumentFiles(
	dir: string,
	out: DirectoryListing,
	inheritedRules: IgnoreRule[] = [],
) {
	const rules = await rulesForDir(dir, inheritedRules);
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (isIgnoredByRules(entryPath, rules)) continue;
		if (entry.isDirectory()) {
			if (isHiddenSidebarFolderName(entry.name)) continue;
			const stat = await fs.stat(entryPath);
			out.folders.push({
				path: toRendererPath(entryPath),
				modified_at: Math.floor(stat.mtimeMs / 1000),
			});
			await collectDocumentFiles(entryPath, out, rules);
		} else if (isDocumentPath(entry.name)) {
			const stat = await fs.stat(entryPath);
			out.files.push({
				path: toRendererPath(entryPath),
				modified_at: Math.floor(stat.mtimeMs / 1000),
			});
		}
	}
}

async function collectWorkspaceFiles(
	root: string,
	dir: string,
	glob: string,
	out: HtmlAppFileEntry[],
	inheritedRules: IgnoreRule[] = [],
) {
	const rules = await rulesForDir(dir, inheritedRules);
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (isIgnoredByRules(entryPath, rules)) continue;
		const relativePath = path
			.relative(root, entryPath)
			.split(path.sep)
			.join("/");
		if (relativePath === ".hubble" || relativePath.startsWith(".hubble/"))
			continue;
		if (entry.isDirectory()) {
			await collectWorkspaceFiles(root, entryPath, glob, out, rules);
			continue;
		}
		if (!matchesGlob(relativePath, glob)) continue;
		const stat = await fs.stat(entryPath);
		out.push({
			name: entry.name,
			path: relativePath,
			modified_at: Math.floor(stat.mtimeMs / 1000),
			size: stat.size,
		});
	}
}

function matchesGlob(relativePath: string, glob: string): boolean {
	if (glob === "" || glob === "**" || glob === "**/*") return true;
	let source = "";
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index];
		const next = glob[index + 1];
		const afterNext = glob[index + 2];
		if (char === "*" && next === "*" && afterNext === "/") {
			source += "(?:.*/)?";
			index += 2;
		} else if (char === "*" && next === "*") {
			source += ".*";
			index += 1;
		} else if (char === "*") {
			source += "[^/]*";
		} else {
			source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
		}
	}
	return new RegExp(`^${source}$`).test(relativePath);
}

async function createWindow() {
	const windowState = await loadWindowState();
	const zoomFactor = loadZoomFactor();
	const window = new BrowserWindow({
		title: appName,
		...(windowState.x !== undefined && windowState.y !== undefined
			? { x: windowState.x, y: windowState.y }
			: {}),
		width: windowState.width,
		height: windowState.height,
		show: false,
		titleBarStyle: "hidden",
		...(process.platform !== "darwin"
			? { titleBarOverlay: titleBarOverlayColors() }
			: {}),
		trafficLightPosition: trafficLightPositionForZoom(zoomFactor),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, "../preload/preload.mjs"),
			sandbox: false,
		},
	});
	mainWindow = window;
	registerTextContextMenu(window);
	if (windowState.isFullScreen) {
		window.setFullScreen(true);
	} else if (windowState.isMaximized) {
		window.maximize();
	}
	// Apply persisted zoom while hidden so the first visible paint is already scaled.
	window.webContents.once("did-finish-load", async () => {
		window.webContents.setZoomFactor(zoomFactor);
		await setTrafficLightInset(window, zoomFactor);
		if (window.isDestroyed()) return;
		window.show();
	});

	window.on("focus", () => sendToRenderer("desktop:window-focus"));

	// On Linux/Windows the menu bar is hidden by the custom title bar, so menu
	// accelerators (incl. DevTools) don't fire. Bind the DevTools toggle directly.
	if (isDev && process.platform !== "darwin") {
		window.webContents.on("before-input-event", (_event, input) => {
			if (input.type !== "keyDown") return;
			const key = input.key.toLowerCase();
			if (key === "f12" || (input.control && input.shift && key === "i")) {
				window.webContents.toggleDevTools();
			}
		});
	}
	window.on("enter-full-screen", () =>
		sendToRenderer("desktop:fullscreen-change", true),
	);
	window.on("leave-full-screen", () =>
		sendToRenderer("desktop:fullscreen-change", false),
	);
	window.on("resize", () => queueSaveWindowState(window));
	window.on("move", () => queueSaveWindowState(window));
	window.on("close", () => {
		if (saveWindowStateTimer) {
			clearTimeout(saveWindowStateTimer);
			saveWindowStateTimer = null;
		}
		saveWindowState(window);
	});
	window.on("closed", () => {
		if (mainWindow === window) mainWindow = null;
	});

	if (isDev && process.env.ELECTRON_RENDERER_URL) {
		await window.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		await window.loadFile(path.join(__dirname, "../renderer/index.html"));
	}
}

function registerIpc() {
	setupTerminalIpc(sendToRenderer);

	ipcMain.handle(
		"desktop:list-directory",
		async (_event, { path: dirPath }) => {
			const root = assertGrantedRoot(dirPath);
			const stat = await fs.stat(root);
			if (!stat.isDirectory()) throw new Error(`Not a directory: ${dirPath}`);
			const listing: DirectoryListing = { files: [], folders: [] };
			await collectDocumentFiles(root, listing);
			return listing;
		},
	);

	ipcMain.handle(
		"desktop:html-app-list-files",
		async (_event, { workspacePath, glob }) => {
			const root = assertGrantedRoot(workspacePath);
			const stat = await fs.stat(root);
			if (!stat.isDirectory())
				throw new Error(`Not a directory: ${workspacePath}`);
			const files: HtmlAppFileEntry[] = [];
			await collectWorkspaceFiles(root, root, String(glob ?? "**/*"), files);
			return files.sort((a, b) => a.path.localeCompare(b.path));
		},
	);

	ipcMain.handle(
		"desktop:read-workspace-config",
		async (_event, { workspacePath }) => {
			try {
				return parseWorkspaceConfig(
					await fs.readFile(workspaceConfigPath(workspacePath), "utf8"),
				);
			} catch (err) {
				if (
					err &&
					typeof err === "object" &&
					"code" in err &&
					err.code === "ENOENT"
				) {
					return emptyWorkspaceConfig();
				}
				throw err;
			}
		},
	);

	ipcMain.handle(
		"desktop:write-workspace-config",
		async (_event, { workspacePath, config }) => {
			const configPath = workspaceConfigPath(workspacePath);
			await fs.mkdir(path.dirname(configPath), { recursive: true });
			await fs.writeFile(
				configPath,
				`${JSON.stringify(normalizeWorkspaceConfig(config), null, 2)}\n`,
			);
			grantFile(configPath);
		},
	);

	ipcMain.handle(
		"desktop:read-file-text",
		async (_event, { path: filePath }) => {
			const resolved = assertGranted(filePath);
			return await fs.readFile(resolved, "utf8");
		},
	);

	ipcMain.handle(
		"desktop:search-file-contents",
		async (_event, { requestId, paths, query }) => {
			latestSearchRequestId = requestId;
			const needle = String(query ?? "").trim();
			const empty = { requestId, results: [], truncated: false };
			if (needle.length < SEARCH_MIN_QUERY_LENGTH) return empty;

			// The renderer hands us the sidebar snapshot's paths, so search sees
			// exactly what the sidebar sees (ADR-0008) and main never re-walks.
			const candidates = (paths as string[]).filter(hasMarkdownExtension);
			const results: SearchFileResult[] = [];
			const isStale = () => requestId !== latestSearchRequestId;
			let cursor = 0;
			let capped = false;

			async function worker() {
				while (true) {
					if (isStale()) return;
					if (results.length >= SEARCH_MAX_RESULT_FILES) {
						capped = true;
						return;
					}
					const index = cursor;
					cursor += 1;
					if (index >= candidates.length) return;

					const candidate = candidates[index];
					try {
						const resolved = assertGranted(candidate);
						const stat = await fs.stat(resolved);
						if (!stat.isFile() || stat.size > SEARCH_MAX_FILE_BYTES) continue;
						const content = await fs.readFile(resolved, "utf8");
						const matches = findMatchesInContent(content, needle);
						if (matches.length > 0) results.push({ path: candidate, matches });
					} catch {}
				}
			}

			await Promise.all(
				Array.from(
					{ length: Math.min(SEARCH_CONCURRENCY, candidates.length) },
					worker,
				),
			);
			if (isStale()) return empty;

			return {
				requestId,
				// The worker pool finishes out of order; sort so equal-ranked results
				// do not jitter between keystrokes.
				results: results
					.slice(0, SEARCH_MAX_RESULT_FILES)
					.sort((a, b) => a.path.localeCompare(b.path)),
				// Workers can push a few past the cap between awaits; the slice hides
				// them, so they must count as truncation. `capped` alone is not
				// enough of a signal in the other direction: a scan that finished
				// with exactly the cap dropped nothing.
				truncated:
					(capped && cursor < candidates.length) ||
					results.length > SEARCH_MAX_RESULT_FILES,
			};
		},
	);

	ipcMain.handle(
		"desktop:write-file-text",
		async (_event, { path: filePath, bytes }) => {
			const resolved = assertGranted(filePath);
			if (!Array.isArray(bytes)) {
				throw new Error("write-file-text requires encoded bytes");
			}
			await fs.mkdir(path.dirname(resolved), { recursive: true });
			// Text is encoded in preload. Main only writes bytes so it cannot
			// accidentally shorten UTF-8 content while crossing string encoders.
			// See https://github.com/bholmesdev/hubble.md/issues/126 for the repro.
			await fs.writeFile(resolved, Uint8Array.from(bytes));
		},
	);

	ipcMain.handle("desktop:create-folder", async (_event, { path: dirPath }) => {
		const resolved = resolvePath(dirPath);
		assertGranted(path.dirname(resolved));
		await fs.mkdir(resolved);
		grantRoot(resolved);
	});

	ipcMain.handle(
		"desktop:rename-file",
		async (_event, { fromPath, toPath }) => {
			const from = assertGranted(fromPath);
			const to = resolvePath(toPath);
			assertGranted(path.dirname(to));
			await fs.mkdir(path.dirname(to), { recursive: true });
			await fs.rename(from, to);
			grantFileWithParent(to);
		},
	);

	ipcMain.handle("desktop:path-exists", async (_event, { path: filePath }) =>
		pathExists(assertGranted(filePath)),
	);

	ipcMain.handle(
		"desktop:detect-hubble-skills",
		async (_event, { workspacePath }) => detectHubbleSkills(workspacePath),
	);

	ipcMain.handle(
		"desktop:persist-pasted-image",
		async (_event, { filePath, bytes, mimeType }) => {
			const resolvedFilePath = assertGranted(filePath);
			if (!Array.isArray(bytes) || bytes.length === 0) {
				throw new Error("Clipboard image bytes are empty");
			}
			const imageBytes = Uint8Array.from(bytes);
			const assetsDir = fileAssetsDir(resolvedFilePath);
			await fs.mkdir(assetsDir, { recursive: true });
			grantRoot(assetsDir);

			const hash = createHash("sha256").update(imageBytes).digest("hex");
			const shortHash = hash.slice(0, 12);
			const ext = extensionFromImage(imageBytes, mimeType);
			let imagePath = path.join(assetsDir, `${shortHash}.${ext}`);
			let deduped = false;

			if (await pathExistsAsFile(imagePath)) {
				const existing = await fs.readFile(imagePath);
				if (Buffer.compare(existing, imageBytes) === 0) {
					deduped = true;
				} else {
					imagePath = path.join(assetsDir, `${hash}.${ext}`);
					if (await pathExistsAsFile(imagePath)) {
						const existingFull = await fs.readFile(imagePath);
						if (Buffer.compare(existingFull, imageBytes) === 0) {
							deduped = true;
						} else {
							throw new Error(
								`Hash collision while saving image at ${imagePath}`,
							);
						}
					}
				}
			}

			if (!deduped && !(await pathExistsAsFile(imagePath))) {
				await fs.writeFile(imagePath, imageBytes);
			}

			grantFile(imagePath);
			return {
				relativeMarkdownPath: path
					.relative(path.dirname(resolvedFilePath), imagePath)
					.split(path.sep)
					.join("/"),
				deduped,
			};
		},
	);

	ipcMain.handle(
		"desktop:delete-file",
		async (_event, { path: filePath, options }) => {
			const resolved = assertGranted(filePath);
			if (options?.recursive === true) {
				await fs.rm(resolved, { recursive: true });
				return;
			}
			try {
				await fs.rm(resolved);
			} catch (err) {
				if (
					err &&
					typeof err === "object" &&
					"code" in err &&
					(err.code === "EISDIR" || err.code === "ERR_FS_EISDIR")
				) {
					await fs.rmdir(resolved);
					return;
				}
				throw err;
			}
		},
	);

	ipcMain.handle(
		"desktop:read-binary-file",
		async (_event, { path: filePath }) =>
			Array.from(await fs.readFile(assertGranted(filePath))),
	);

	ipcMain.handle(
		"desktop:write-binary-file",
		async (_event, { path: filePath, bytes }) => {
			if (!Array.isArray(bytes)) throw new Error("Bytes must be an array");
			await fs.writeFile(assertGranted(filePath), Uint8Array.from(bytes));
		},
	);

	ipcMain.handle("desktop:open-file-picker", async (_event, options = {}) => {
		const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
			properties: ["openFile"],
			defaultPath:
				typeof options.defaultPath === "string"
					? options.defaultPath
					: undefined,
			title: "Open Markdown file",
			filters: [
				{ name: "Documents", extensions: ["md", "markdown", "mdown", "html"] },
				{ name: "Text", extensions: ["txt", "text"] },
			],
		});
		const selected = result.filePaths[0] ?? null;
		if (selected) grantFileWithParent(selected);
		return selected ? toRendererPath(selected) : null;
	});

	ipcMain.handle("desktop:open-folder-picker", async () => {
		const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
			properties: ["openDirectory"],
			title: "Open Folder",
		});
		const selected = result.filePaths[0] ?? null;
		if (selected) grantRoot(selected);
		return selected ? toRendererPath(selected) : null;
	});

	ipcMain.handle("desktop:create-folder-picker", async () => {
		// macOS save dialog supports naming a new folder inline via createDirectory.
		if (process.platform === "darwin") {
			const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
				title: "New Folder",
				nameFieldLabel: "Folder name:",
				buttonLabel: "Create",
				properties: ["createDirectory"],
			});
			if (result.canceled || !result.filePath) return null;
			const folderPath = result.filePath;
			await fs.mkdir(folderPath, { recursive: true });
			grantRoot(folderPath);
			return toRendererPath(folderPath);
		}
		// Linux/Windows: the native directory picker has a "New Folder" button,
		// so create + select happen there and the path opens as the workspace.
		const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
			title: "New Folder",
			buttonLabel: "Create",
			properties: ["openDirectory", "createDirectory"],
		});
		const selected = result.filePaths[0] ?? null;
		if (!selected) return null;
		await fs.mkdir(selected, { recursive: true });
		grantRoot(selected);
		return toRendererPath(selected);
	});

	ipcMain.handle(
		"desktop:save-markdown-file-picker",
		async (_event, options = {}) => {
			const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
				defaultPath:
					typeof options.defaultPath === "string"
						? options.defaultPath
						: undefined,
				title: "New Markdown file",
				filters: [{ name: "Markdown", extensions: ["md"] }],
			});
			if (result.canceled || !result.filePath) return null;
			const selected = withMarkdownExtension(result.filePath);
			grantFileWithParent(selected);
			return toRendererPath(selected);
		},
	);

	ipcMain.handle(
		"desktop:watch-path",
		async (_event, { watchId, path: watchPath }) => {
			const id = String(watchId);
			const resolved = assertGranted(watchPath);
			const emit = (changedPath: string) => {
				sendToRenderer(`desktop:watch-path:${watchId}`, [
					toRendererPath(path.resolve(changedPath)),
				]);
			};

			const createWatcher = async () => {
				const watcher = chokidar.watch(resolved, {
					ignoreInitial: true,
					// Only the active file uses this watcher. The sidebar refreshes from
					// snapshots so large workspaces do not create one watcher per folder.
					depth: 0,
				});
				const emitFile = (changedPath: string) => {
					if (isDocumentPath(changedPath)) {
						emit(changedPath);
					}
				};
				watcher.on("add", emitFile);
				watcher.on("change", emitFile);
				watcher.on("unlink", emitFile);
				watcher.on("addDir", emit);
				watcher.on("unlinkDir", emit);
				watcher.on("error", (error) => {
					console.error("File watcher failed:", error);
				});
				return watcher;
			};

			watchers.set(id, await createWatcher());
		},
	);

	ipcMain.handle("desktop:unwatch-path", async (_event, { watchId }) => {
		const watcher = watchers.get(String(watchId));
		if (watcher) {
			watchers.delete(String(watchId));
			await watcher.close();
		}
	});

	ipcMain.handle("desktop:open-external-url", async (_event, { url }) => {
		if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
			throw new Error("Only http(s) external URLs are allowed");
		}
		await shell.openExternal(url);
	});

	ipcMain.handle("desktop:open-path-from-link", async (_event, { path }) => {
		const resolved = await assertGrantedOrConfirmFile(path);
		if (hasMarkdownExtension(resolved)) {
			if (!(await pathExistsAsFile(resolved))) {
				throw new Error("FILE_NOT_FOUND");
			}
			return { kind: "markdown", path: toRendererPath(resolved) };
		}
		await shell.openPath(resolved);
		return { kind: "opened" };
	});

	ipcMain.handle("desktop:reveal-file", (_event, { path: filePath }) => {
		shell.showItemInFolder(assertGranted(filePath));
	});

	ipcMain.handle("desktop:resolve-path", (_event, { path }) =>
		toRendererPath(resolvePath(path)),
	);

	ipcMain.handle("desktop:real-path", async (_event, { path: filePath }) =>
		toRendererPath(await fs.realpath(assertGranted(filePath))),
	);

	ipcMain.handle("desktop:get-launch-file-path", () => {
		const pathToOpen = pendingOpenPath;
		pendingOpenPath = null;
		return pathToOpen ? toRendererPath(pathToOpen) : null;
	});

	ipcMain.handle("desktop:get-launch-workspace-path", () =>
		launchWorkspacePath ? toRendererPath(launchWorkspacePath) : null,
	);

	ipcMain.handle("desktop:get-update-state", () => updateState);

	ipcMain.handle(
		"desktop:get-fullscreen",
		() => mainWindow?.isFullScreen() ?? false,
	);

	ipcMain.handle("desktop:check-for-updates", async () => {
		await checkForUpdates();
	});

	ipcMain.handle("desktop:install-update", () => {
		if (updateState.status !== "ready") {
			throw new Error("No downloaded update is ready to install.");
		}
		autoUpdater.quitAndInstall(false, true);
	});

	ipcMain.handle("desktop:set-menu-state", (_event, state: MenuState) => {
		menuState = {
			hasWorkspace: state.hasWorkspace === true,
			hasMarkdownNoteOpen: state.hasMarkdownNoteOpen === true,
			isSourceMode: state.isSourceMode === true,
			canGoBack: state.canGoBack === true,
			canGoForward: state.canGoForward === true,
		};
		buildMenu();
	});
}

protocol.registerSchemesAsPrivileged([
	{
		scheme: "hubble-asset",
		privileges: {
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
			standard: true,
		},
	},
]);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const openPath = firstExistingFileArg(argv.slice(1));
		if (!openPath) return;
		pendingOpenPath = openPath;
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
			sendToRenderer("desktop:open-file", toRendererPath(openPath));
		}
	});

	app.on("open-file", (event, filePath) => {
		event.preventDefault();
		const resolved = resolvePath(filePath);
		grantFileWithParent(resolved);
		pendingOpenPath = resolved;
		sendToRenderer("desktop:open-file", toRendererPath(resolved));
	});

	app.whenReady().then(async () => {
		await loadGrants();
		if (launchWorkspacePath) grantRoot(launchWorkspacePath);
		await saveGrants();
		protocol.handle("hubble-asset", (request) => {
			const url = new URL(request.url);
			const filePath = assertGranted(assetPathFromUrl(url));
			// HTML apps use this protocol as their base URL, so relative
			// scripts, stylesheets, images, and fetches resolve to granted files.
			// Disable caching because these files are edited directly in workspaces.
			return responseForAsset(filePath);
		});
		registerIpc();
		buildMenu();
		configureAutoUpdates();
		await createWindow();
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			void createWindow();
		}
	});
}
