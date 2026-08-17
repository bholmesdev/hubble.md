import os from "node:os";
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../src/desktopApi/types";

function subscribe<T extends unknown[]>(
	channel: string,
	callback: (...args: T) => void,
) {
	const listener = (_event: Electron.IpcRendererEvent, ...args: T) =>
		callback(...args);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

let nextWatchId = 0;

const desktopApi = {
	platform: process.platform,
	homeDir: os.homedir(),
	listDirectory: (path) =>
		ipcRenderer.invoke("desktop:list-directory", { path }),
	listHtmlAppFiles: (workspacePath, glob) =>
		ipcRenderer.invoke("desktop:html-app-list-files", { workspacePath, glob }),
	readWorkspaceConfig: (workspacePath) =>
		ipcRenderer.invoke("desktop:read-workspace-config", { workspacePath }),
	writeWorkspaceConfig: (workspacePath, config) =>
		ipcRenderer.invoke("desktop:write-workspace-config", {
			workspacePath,
			config,
		}),
	readFileText: (path) =>
		ipcRenderer.invoke("desktop:read-file-text", { path }),
	searchFileContents: (input) =>
		ipcRenderer.invoke("desktop:search-file-contents", input),
	detectHubbleSkills: (workspacePath) =>
		ipcRenderer.invoke("desktop:detect-hubble-skills", { workspacePath }),
	writeFileText: (path, content) => {
		// Encode in the renderer before IPC. Main should write these bytes as-is,
		// because re-encoding the string there has truncated multibyte characters.
		const bytes = Array.from(new TextEncoder().encode(String(content)));
		return ipcRenderer.invoke("desktop:write-file-text", {
			path,
			bytes,
		});
	},
	materializeTemplate: (input) =>
		ipcRenderer.invoke("desktop:materialize-template", input),
	rollbackTemplateMaterialization: (cleanupToken) =>
		ipcRenderer.invoke("desktop:rollback-template-materialization", {
			cleanupToken,
		}),
	createFolder: (path) => ipcRenderer.invoke("desktop:create-folder", { path }),
	renameFile: (fromPath, toPath) =>
		ipcRenderer.invoke("desktop:rename-file", { fromPath, toPath }),
	pathExists: (path) => ipcRenderer.invoke("desktop:path-exists", { path }),
	persistPastedImage: (input) =>
		ipcRenderer.invoke("desktop:persist-pasted-image", input),
	deleteFile: (path, options) =>
		ipcRenderer.invoke("desktop:delete-file", { path, options }),
	stageDelete: (workspacePath, paths) =>
		ipcRenderer.invoke("desktop:stage-delete", { workspacePath, paths }),
	undoText: () => ipcRenderer.invoke("desktop:undo-text"),
	restoreDelete: (token) =>
		ipcRenderer.invoke("desktop:restore-delete", { token }),
	finalizeDelete: (token) =>
		ipcRenderer.invoke("desktop:finalize-delete", { token }),
	setDeleteUndoAvailable: (available) =>
		ipcRenderer.invoke("desktop:set-delete-undo-available", { available }),
	readBinaryFile: (path) =>
		ipcRenderer.invoke("desktop:read-binary-file", { path }),
	writeBinaryFile: (path, bytes) =>
		ipcRenderer.invoke("desktop:write-binary-file", { path, bytes }),
	openFilePicker: (options) =>
		ipcRenderer.invoke("desktop:open-file-picker", options),
	openFolderPicker: () => ipcRenderer.invoke("desktop:open-folder-picker"),
	createFolderPicker: () => ipcRenderer.invoke("desktop:create-folder-picker"),
	saveMarkdownFilePicker: (options) =>
		ipcRenderer.invoke("desktop:save-markdown-file-picker", options),
	startWorkspaceWatcher: (path) =>
		ipcRenderer.invoke("desktop:start-workspace-watcher", { path }),
	stopWorkspaceWatcher: (generation) =>
		ipcRenderer.invoke("desktop:stop-workspace-watcher", { generation }),
	sidebarDeltaForPath: (workspacePath, changedPath) =>
		ipcRenderer.invoke("desktop:sidebar-delta-for-path", {
			workspacePath,
			changedPath,
		}),
	watchPath: async (path, options, callback) => {
		const watchId = String(++nextWatchId);
		const unsubscribeEvents = subscribe(
			`desktop:watch-path:${watchId}`,
			(paths: string[]) => callback(paths),
		);
		await ipcRenderer.invoke("desktop:watch-path", { watchId, path, options });
		return () => {
			unsubscribeEvents();
			void ipcRenderer.invoke("desktop:unwatch-path", { watchId });
		};
	},
	openExternalUrl: (url) =>
		ipcRenderer.invoke("desktop:open-external-url", { url }),
	openAgentClient: (input) =>
		ipcRenderer.invoke("desktop:open-agent-client", input),
	openPathFromLink: (path) =>
		ipcRenderer.invoke("desktop:open-path-from-link", { path }),
	openPathInDefaultApp: (path) =>
		ipcRenderer.invoke("desktop:open-path-in-default-app", { path }),
	revealFile: (path) => ipcRenderer.invoke("desktop:reveal-file", { path }),
	resolvePath: (path) => ipcRenderer.invoke("desktop:resolve-path", { path }),
	realPath: (path) => ipcRenderer.invoke("desktop:real-path", { path }),
	toAssetUrl: (path) =>
		`hubble-asset://local/?path=${encodeURIComponent(path)}`,
	getLaunchFilePath: () => ipcRenderer.invoke("desktop:get-launch-file-path"),
	getLaunchWorkspacePath: () =>
		ipcRenderer.invoke("desktop:get-launch-workspace-path"),
	setThemeSource: (source) =>
		ipcRenderer.invoke("desktop:set-theme-source", { source }),
	setMenuState: (state) => ipcRenderer.invoke("desktop:set-menu-state", state),
	getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
	getTelemetryConsent: () =>
		ipcRenderer.invoke("desktop:get-telemetry-consent"),
	setTelemetryConsent: (consent) =>
		ipcRenderer.invoke("desktop:set-telemetry-consent", { consent }),
	recordTelemetryActivity: (input) =>
		ipcRenderer.invoke("desktop:record-telemetry-activity", input),
	getFullScreen: () => ipcRenderer.invoke("desktop:get-fullscreen"),
	moveWindow: (x, y) => ipcRenderer.invoke("desktop:move-window", { x, y }),
	zoomWindow: (direction) =>
		ipcRenderer.invoke("desktop:zoom-window", { direction }),
	checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
	installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
	onOpenFile: (callback) =>
		subscribe("desktop:open-file", (path: string) => callback(path)),
	onUpdateStateChange: (callback) =>
		subscribe("desktop:update-state", callback),
	onMenuCreateMarkdownFile: (callback) =>
		subscribe("desktop:menu-create-markdown-file", callback),
	onMenuCreateHtmlFile: (callback) =>
		subscribe("desktop:menu-create-html-file", callback),
	onMenuOpenFile: (callback) => subscribe("desktop:menu-open-file", callback),
	onMenuOpenFolder: (callback) =>
		subscribe("desktop:menu-open-folder", callback),
	onMenuOpenSettings: (callback) =>
		subscribe("desktop:menu-open-settings", callback),
	onMenuOpenChangelog: (callback) =>
		subscribe("desktop:menu-open-changelog", callback),
	onMenuCopyAsMarkdown: (callback) =>
		subscribe("desktop:menu-copy-as-markdown", callback),
	onMenuShowWorkspaceSwitcher: (callback) =>
		subscribe("desktop:menu-show-workspace-switcher", callback),
	onMenuGoToFile: (callback) => subscribe("desktop:menu-go-to-file", callback),
	onMenuSyncWorkspace: (callback) =>
		subscribe("desktop:menu-sync-workspace", callback),
	onWorkspaceChanged: (callback) =>
		subscribe("desktop:workspace-changed", callback),
	onMenuToggleTerminal: (callback) =>
		subscribe("desktop:menu-toggle-terminal", callback),
	onMenuGoBack: (callback) => subscribe("desktop:menu-go-back", callback),
	onMenuGoForward: (callback) => subscribe("desktop:menu-go-forward", callback),
	onMenuToggleSourceMode: (callback) =>
		subscribe("desktop:menu-toggle-source-mode", callback),
	onUndoDelete: (callback) => subscribe("desktop:undo-delete", callback),
	onWindowFocus: (callback) => subscribe("desktop:window-focus", callback),
	onFullScreenChange: (callback) =>
		subscribe("desktop:fullscreen-change", (isFullScreen: boolean) =>
			callback(isFullScreen),
		),
	terminalStart: (cwd, options) =>
		ipcRenderer.invoke("desktop:terminal-start", { cwd, ...options }),
	terminalWrite: (sessionId, data) =>
		ipcRenderer.invoke("desktop:terminal-write", { sessionId, data }),
	terminalResize: (sessionId, cols, rows) =>
		ipcRenderer.invoke("desktop:terminal-resize", { sessionId, cols, rows }),
	terminalStop: (sessionId) =>
		ipcRenderer.invoke("desktop:terminal-stop", { sessionId }),
	onTerminalData: (sessionId, callback) => {
		const unsubscribe = subscribe(
			`desktop:terminal-data-${sessionId}`,
			callback,
		);
		void ipcRenderer.invoke("desktop:terminal-subscribe", { sessionId });
		return unsubscribe;
	},
	onTerminalExit: (sessionId, callback) =>
		subscribe(`desktop:terminal-exit-${sessionId}`, callback),
} satisfies DesktopApi;

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
