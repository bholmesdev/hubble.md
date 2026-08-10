import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type AppCommandId, getCommand } from "@hubble.md/editor/commands";
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
	session,
	shell,
} from "electron";
import electronUpdater from "electron-updater";
import { z } from "zod/v4";
import type {
	DesktopUpdateState,
	HtmlAppFileEntry,
	MenuState,
	SearchFileResult,
	WorkspaceConfig,
} from "../src/desktopApi/types";
import {
	fileKindForPath,
	HUBBLE_DIR,
	hasMarkdownExtension,
	isEditableFile,
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
import type { ThemePreference } from "../src/theme";
import { DeleteUndo } from "./deleteUndo";
import { TelemetryManager } from "./telemetry";
import { setupTerminalIpc } from "./terminal";
import {
	collectWorkspaceFiles,
	listSidebarFiles,
	sidebarDeltaForPath,
} from "./workspaceSidebar";
import { type WatchHandle, watchWorkspace } from "./workspaceWatcher";
import {
	loadZoomFactor,
	resetWindowZoom,
	setTrafficLightInset,
	stepWindowZoom,
	toolbarHeight,
	trafficLightPositionForZoom,
	zoomStep,
} from "./zoom";

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
// Windows/Linux draw the min/max/close buttons as a native overlay whose colors
// are static unless we update them. Mirror the app palette so the button strip
// follows the OS appearance instead of staying light in dark mode.
function titleBarOverlayOptions() {
	const colors = nativeTheme.shouldUseDarkColors
		? { color: "#181715", symbolColor: "#a6a5a0" }
		: { color: "#ffffff", symbolColor: "#454545" };
	return { ...colors, height: toolbarHeight };
}

app.setName(appName);
if (devAppName) {
	app.setPath("userData", path.join(app.getPath("appData"), devAppName));
}

// The renderer owns the preference and mirrors it to a `.dark` class, but native
// chrome and sandboxed HTML apps read `themeSource`. Restore it before the window
// exists so those are right on the first frame, after the userData override above.
nativeTheme.themeSource = loadThemeSource();
const telemetry = new TelemetryManager({
	statePath: path.join(app.getPath("userData"), "telemetry.json"),
	endpoint:
		process.env.HUBBLE_PLAUSIBLE_ENDPOINT ?? "https://plausible.io/api/event",
	domain: process.env.HUBBLE_PLAUSIBLE_DOMAIN ?? "hubble.md",
	canSend: app.isPackaged && process.env.HUBBLE_TELEMETRY_DISABLED !== "1",
	version: app.getVersion(),
	userAgent: () => session.defaultSession.getUserAgent(),
});

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
			mainWindow.setTitleBarOverlay(titleBarOverlayOptions());
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
	hasSourceViewOpen: false,
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
type ActiveWorkspaceWatcher = {
	root: string;
	generation: number;
	handle: WatchHandle;
};
let workspaceWatcher: ActiveWorkspaceWatcher | null = null;
let workspaceWatcherGeneration = 0;
// Root validation is async; serialize starts so stale IPC requests cannot
// replace a newer workspace watcher while validation is in flight.
let workspaceWatcherStart = Promise.resolve();
const grantedFiles = new Set<string>();
const grantedRoots = new Set<string>();
let grantsLoaded = false;
let deleteUndoAvailable = false;
const deleteUndo = new DeleteUndo();
// An AbortSignal cannot cross IPC, so a superseded search is abandoned by
// comparing its id against the newest one between files.
let latestSearchRequestId = 0;

const workspaceConfigVersion = 1;
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
const minWindowWidth = 360;
const defaultWindowState: WindowState = { width: 920, height: 720 };
const windowStateSchema = z.object({
	width: z.number().int().min(minWindowWidth).max(4096),
	height: z.number().int().min(480).max(4096),
	x: z.number().int().optional(),
	y: z.number().int().optional(),
	isMaximized: z.boolean().optional(),
	isFullScreen: z.boolean().optional(),
});
const openAgentClientSchema = z
	.object({
		client: z.enum(["codex", "claude"]),
		prompt: z.string(),
		workspacePath: z.string().trim().min(1),
	})
	.strict();
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

function themeSourcePath(): string {
	return path.join(app.getPath("userData"), "theme.json");
}

function isThemePreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

function loadThemeSource(): ThemePreference {
	try {
		const raw = fsSync.readFileSync(themeSourcePath(), "utf8");
		const source = JSON.parse(raw).source;
		if (isThemePreference(source)) return source;
	} catch {
		// Missing or malformed theme state just means following the OS.
	}
	return "system";
}

function saveThemeSource(source: ThemePreference) {
	try {
		fsSync.mkdirSync(path.dirname(themeSourcePath()), { recursive: true });
		fsSync.writeFileSync(
			themeSourcePath(),
			JSON.stringify({ source }, null, 2),
		);
	} catch {
		// Best-effort cache; the renderer resends the preference on every launch.
	}
}

type SpellcheckConfig = {
	enabled: boolean;
	languages: string[];
};

function spellcheckConfigPath(): string {
	return path.join(app.getPath("userData"), "spellcheck.json");
}

function loadSpellcheckConfig(): SpellcheckConfig | null {
	try {
		const parsed = JSON.parse(
			fsSync.readFileSync(spellcheckConfigPath(), "utf8"),
		);
		if (
			typeof parsed?.enabled === "boolean" &&
			Array.isArray(parsed?.languages)
		) {
			return {
				enabled: parsed.enabled,
				languages: parsed.languages.filter(
					(lang: unknown) => typeof lang === "string",
				),
			};
		}
	} catch {
		// Missing or malformed, so fall through to defaults.
	}
	return null;
}

function getSpellcheckConfig(): SpellcheckConfig {
	const { defaultSession } = session;
	return {
		enabled: defaultSession.spellCheckerEnabled,
		languages: defaultSession.getSpellCheckerLanguages(),
	};
}

function saveSpellcheckConfig() {
	try {
		fsSync.mkdirSync(path.dirname(spellcheckConfigPath()), {
			recursive: true,
		});
		fsSync.writeFileSync(
			spellcheckConfigPath(),
			JSON.stringify(getSpellcheckConfig(), null, 2),
		);
	} catch {
		// Best-effort cache; the session keeps the live values either way.
	}
}

function restoreSpellcheckConfig() {
	const saved = loadSpellcheckConfig();
	if (!saved) return;
	session.defaultSession.spellCheckerEnabled = saved.enabled;
	applySpellcheckLanguages(saved.languages);
}

function applySpellcheckLanguages(languages: string[]) {
	// macOS picks languages itself and ignores setSpellCheckerLanguages.
	if (process.platform === "darwin") return;
	const valid = languages.filter((lang) =>
		session.defaultSession.availableSpellCheckerLanguages.includes(lang),
	);
	if (valid.length === 0) return;
	session.defaultSession.setSpellCheckerLanguages(valid);
}

function workspaceConfigPath(workspacePath: string): string {
	const root = assertGrantedRoot(workspacePath);
	return path.join(root, HUBBLE_DIR, workspaceConfigFile);
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

function stopWorkspaceWatcher() {
	workspaceWatcherGeneration += 1;
	workspaceWatcher?.handle.close();
	workspaceWatcher = null;
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
		case ".htm":
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
		case ".avif":
			return "image/avif";
		case ".bmp":
			return "image/bmp";
		case ".gif":
			return "image/gif";
		case ".ico":
			return "image/x-icon";
		case ".png":
			return "image/png";
		case ".webp":
			return "image/webp";
		case ".pdf":
			return "application/pdf";
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
	const isHtml = contentType.startsWith("text/html");
	const body = isHtml
		? injectHtmlAppRuntime(fsSync.readFileSync(filePath, "utf8"))
		: fsSync.readFileSync(filePath);

	// Keep scriptable documents sandboxed even when a frame (e.g. the PDF
	// viewer) navigates to them directly. <img> SVG rendering is unaffected.
	const cspSandbox = isHtml
		? "sandbox allow-scripts allow-forms"
		: contentType === "image/svg+xml"
			? "sandbox"
			: null;

	return new Response(body, {
		headers: {
			"cache-control": "no-store",
			"content-type": contentType,
			...(cspSandbox ? { "content-security-policy": cspSandbox } : {}),
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
		label: getCommand("app.copy-as-markdown").label,
		accelerator: getCommand("app.copy-as-markdown").defaultBinding,
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

function commandMenuItem(
	id: AppCommandId,
	click: () => void,
): Electron.MenuItemConstructorOptions {
	const command = getCommand(id);
	return {
		id,
		label: command.label,
		accelerator: command.defaultBinding,
		enabled: command.isEnabled(menuState),
		click,
	};
}

function buildMenu() {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: "File",
			submenu: [
				commandMenuItem("app.new-file", () =>
					sendToRenderer("desktop:menu-create-markdown-file"),
				),
				{
					id: "new-html-file",
					label: "New HTML App",
					click: () => sendToRenderer("desktop:menu-create-html-file"),
				},
				{ type: "separator" },
				commandMenuItem("app.open-file", () =>
					sendToRenderer("desktop:menu-open-file"),
				),
				commandMenuItem("app.open-folder", () =>
					sendToRenderer("desktop:menu-open-folder"),
				),
				commandMenuItem("app.open-recent", () =>
					sendToRenderer("desktop:menu-show-workspace-switcher"),
				),
				{ type: "separator" },
				commandMenuItem("app.go-to-file", () =>
					sendToRenderer("desktop:menu-go-to-file"),
				),
				{ type: "separator" },
				{
					id: "sync-workspace",
					label: "Refresh Folder",
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
				deleteUndoAvailable
					? {
							label: "Undo Delete",
							accelerator: "CmdOrCtrl+Z",
							click: () => sendToRenderer("desktop:undo-delete"),
						}
					: { role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				commandMenuItem("app.copy-as-markdown", () =>
					sendToRenderer("desktop:menu-copy-as-markdown"),
				),
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				commandMenuItem("app.go-back", () =>
					sendToRenderer("desktop:menu-go-back"),
				),
				commandMenuItem("app.go-forward", () =>
					sendToRenderer("desktop:menu-go-forward"),
				),
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
				commandMenuItem("app.toggle-terminal", () =>
					sendToRenderer("desktop:menu-toggle-terminal"),
				),
				commandMenuItem("app.toggle-source-mode", () =>
					sendToRenderer("desktop:menu-toggle-source-mode"),
				),
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
				commandMenuItem("app.settings", () =>
					sendToRenderer("desktop:menu-open-settings"),
				),
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
		minWidth: minWindowWidth,
		show: false,
		titleBarStyle: "hidden",
		...(process.platform !== "darwin"
			? { titleBarOverlay: titleBarOverlayOptions() }
			: {}),
		trafficLightPosition: trafficLightPositionForZoom(zoomFactor),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			plugins: true,
			preload: path.join(__dirname, "../preload/preload.mjs"),
			sandbox: false,
		},
	});
	mainWindow = window;
	// Viewer content must never navigate the window or open new ones; external
	// links go through shell IPC. Unlike will-navigate, this covers subframes.
	window.webContents.on("will-frame-navigate", (details) => {
		if (details.isMainFrame) {
			// Same-URL navigations are dev HMR reloads.
			if (details.url !== window.webContents.getURL()) details.preventDefault();
			return;
		}
		// Subframes load app assets only; chrome-extension is Chromium's
		// internal PDF viewer taking over the frame.
		if (
			!details.url.startsWith("hubble-asset://") &&
			!details.url.startsWith("chrome-extension://") &&
			details.url !== "about:blank"
		) {
			details.preventDefault();
		}
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
		"desktop:start-workspace-watcher",
		async (_event, { path: dirPath }) => {
			const start = workspaceWatcherStart.then(async () => {
				const root = assertGrantedRoot(dirPath);
				const rootStat = await fs.stat(root);
				if (!rootStat.isDirectory()) return null;
				if (workspaceWatcher?.root === root) {
					return workspaceWatcher.generation;
				}
				stopWorkspaceWatcher();
				const generation = workspaceWatcherGeneration;
				const watcher = watchWorkspace(
					root,
					(paths) => {
						if (workspaceWatcher?.generation !== generation) return;
						sendToRenderer("desktop:workspace-changed", {
							kind: "paths",
							paths,
						});
					},
					(reason) => {
						if (workspaceWatcher?.generation !== generation) return;
						if (reason === "watch-error") stopWorkspaceWatcher();
						sendToRenderer("desktop:workspace-changed", {
							kind: "refresh",
						});
					},
				);
				if (!watcher || workspaceWatcherGeneration !== generation) {
					watcher?.close();
					return null;
				}
				workspaceWatcher = { root, generation, handle: watcher };
				return generation;
			});
			workspaceWatcherStart = start.then(
				() => undefined,
				() => undefined,
			);
			return start;
		},
	);

	ipcMain.handle(
		"desktop:stop-workspace-watcher",
		async (_event, { generation }) => {
			if (workspaceWatcher?.generation === generation) {
				stopWorkspaceWatcher();
			}
		},
	);

	ipcMain.handle(
		"desktop:sidebar-delta-for-path",
		async (_event, { workspacePath, changedPath }) => {
			const root = assertGranted(workspacePath);
			if (!workspaceWatcher || workspaceWatcher.root !== root) return null;
			const resolvedPath = resolvePath(changedPath);
			if (!isWithin(root, resolvedPath)) return { kind: "refresh" };
			try {
				return await sidebarDeltaForPath(root, resolvedPath);
			} catch (error) {
				console.error("Workspace path reconciliation failed:", error);
				return { kind: "refresh" };
			}
		},
	);

	ipcMain.handle(
		"desktop:list-directory",
		async (_event, { path: dirPath }) => {
			const root = assertGrantedRoot(dirPath);
			const stat = await fs.stat(root);
			if (!stat.isDirectory()) {
				throw new Error(`Not a directory: ${dirPath}`);
			}
			await deleteUndo.clean(root);
			return listSidebarFiles(root);
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
		"desktop:stage-delete",
		async (
			_event,
			{ workspacePath, paths }: { workspacePath: string; paths: string[] },
		) =>
			deleteUndo.stage(assertGranted(workspacePath), paths.map(assertGranted)),
	);

	ipcMain.handle(
		"desktop:restore-delete",
		async (_event, { token }: { token: string }) => {
			for (const restoredPath of await deleteUndo.restore(token)) {
				grantFileWithParent(restoredPath);
			}
		},
	);

	ipcMain.handle(
		"desktop:finalize-delete",
		(_event, { token }: { token: string }) => deleteUndo.drop(token),
	);

	ipcMain.handle(
		"desktop:set-delete-undo-available",
		(_event, { available }: { available: boolean }) => {
			deleteUndoAvailable = available === true;
			buildMenu();
		},
	);
	ipcMain.handle("desktop:undo-text", (event) => event.sender.undo());

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
			title: "Open file",
			filters: [
				{ name: "Documents", extensions: ["md", "markdown", "mdown", "html"] },
				{ name: "Text", extensions: ["txt", "text"] },
				{ name: "PDF", extensions: ["pdf"] },
				{ name: "All Files", extensions: ["*"] },
			],
		});
		const selected = result.filePaths[0] ?? null;
		if (!selected || !(await pathExistsAsFile(selected))) return null;
		grantFileWithParent(selected);
		return toRendererPath(selected);
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
					if (isEditableFile(changedPath)) {
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

	ipcMain.handle("desktop:open-agent-client", async (_event, input) => {
		const { client, prompt, workspacePath } =
			openAgentClientSchema.parse(input);
		const resolvedWorkspacePath = assertGranted(workspacePath);
		if (!(await fs.stat(resolvedWorkspacePath)).isDirectory()) {
			throw new Error(`Not a directory: ${workspacePath}`);
		}

		// Build the custom-protocol URL here so the renderer cannot choose an
		// arbitrary external scheme or workspace outside its granted scope.
		const url = new URL(
			client === "codex" ? "codex://threads/new" : "claude://code/new",
		);
		url.searchParams.set(client === "codex" ? "prompt" : "q", prompt);
		url.searchParams.set(
			client === "codex" ? "path" : "folder",
			resolvedWorkspacePath,
		);
		await shell.openExternal(url.href);
	});

	ipcMain.handle("desktop:open-path-from-link", async (_event, { path }) => {
		const resolved = await assertGrantedOrConfirmFile(path);
		if (fileKindForPath(resolved) !== "external") {
			if (!(await pathExistsAsFile(resolved))) {
				throw new Error("FILE_NOT_FOUND");
			}
			return { kind: "file", path: toRendererPath(resolved) };
		}
		const openError = await shell.openPath(resolved);
		if (openError) throw new Error(openError);
		return { kind: "opened" };
	});

	ipcMain.handle(
		"desktop:open-path-in-default-app",
		async (_event, { path }) => {
			const resolved = assertGranted(path);
			const error = await shell.openPath(resolved);
			if (error) throw new Error(error);
		},
	);

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
	ipcMain.handle("desktop:get-telemetry-consent", () => telemetry.getConsent());
	ipcMain.handle("desktop:set-telemetry-consent", (_event, { consent }) => {
		if (consent !== "enabled" && consent !== "declined") {
			throw new Error("Invalid telemetry consent");
		}
		return telemetry.setConsent(consent);
	});
	ipcMain.handle("desktop:record-telemetry-activity", (_event, input) =>
		telemetry.recordActivity(input?.usedHtmlApp === true),
	);

	ipcMain.handle(
		"desktop:get-fullscreen",
		() => mainWindow?.isFullScreen() ?? false,
	);

	ipcMain.handle("desktop:move-window", (_event, input: unknown) => {
		const x =
			typeof input === "object" && input !== null && "x" in input
				? input.x
				: undefined;
		const y =
			typeof input === "object" && input !== null && "y" in input
				? input.y
				: undefined;
		if (
			typeof x !== "number" ||
			!Number.isFinite(x) ||
			typeof y !== "number" ||
			!Number.isFinite(y)
		) {
			throw new Error("Invalid window position");
		}
		mainWindow?.setPosition(x, y);
	});

	ipcMain.handle("desktop:zoom-window", (_event, input: unknown) => {
		const direction =
			typeof input === "object" && input !== null && "direction" in input
				? input.direction
				: undefined;
		if (direction !== "in" && direction !== "out" && direction !== "reset") {
			throw new Error("Invalid zoom direction");
		}
		if (direction === "reset") {
			resetWindowZoom(mainWindow);
			return;
		}
		stepWindowZoom(mainWindow, direction === "out" ? -zoomStep : zoomStep);
	});

	ipcMain.handle("desktop:check-for-updates", async () => {
		await checkForUpdates();
	});

	ipcMain.handle("desktop:install-update", () => {
		if (updateState.status !== "ready") {
			throw new Error("No downloaded update is ready to install.");
		}
		autoUpdater.quitAndInstall(false, true);
	});

	ipcMain.handle(
		"desktop:set-theme-source",
		(_event, { source }: { source: ThemePreference }) => {
			nativeTheme.themeSource = isThemePreference(source) ? source : "system";
			saveThemeSource(nativeTheme.themeSource);
		},
	);

	ipcMain.handle("desktop:get-spellcheck-state", () => {
		const { defaultSession } = session;
		return {
			...getSpellcheckConfig(),
			availableLanguages: defaultSession.availableSpellCheckerLanguages,
			systemLanguage:
				app.getPreferredSystemLanguages()[0] ?? app.getSystemLocale(),
		};
	});

	ipcMain.handle(
		"desktop:set-spellcheck-enabled",
		(_event, payload: { enabled?: unknown }) => {
			session.defaultSession.spellCheckerEnabled = payload?.enabled === true;
			saveSpellcheckConfig();
		},
	);

	ipcMain.handle(
		"desktop:set-spellcheck-languages",
		(_event, payload: { languages?: unknown }) => {
			const languages = Array.isArray(payload?.languages)
				? payload.languages.filter(
						(language): language is string => typeof language === "string",
					)
				: [];
			applySpellcheckLanguages(languages);
			saveSpellcheckConfig();
		},
	);

	ipcMain.handle("desktop:set-menu-state", (_event, state: MenuState) => {
		menuState = {
			hasWorkspace: state.hasWorkspace === true,
			hasSourceViewOpen: state.hasSourceViewOpen === true,
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

	// "Desktop Active" means the app was used that day (TELEMETRY.md): launch
	// covers the first day, focus covers sessions left open across midnight.
	app.on("browser-window-focus", () => void telemetry.recordActivity(false));

	app.whenReady().then(async () => {
		await telemetry.load();
		void telemetry.recordActivity(false);
		restoreSpellcheckConfig();
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
