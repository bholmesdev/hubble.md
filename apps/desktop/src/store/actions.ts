import {
	formatShortcut,
	type ReviewThread,
	type SidebarDeleteItem,
} from "@hubble.md/ui";
import { toast } from "sonner";
import changelogRaw from "../../../../CHANGELOG.md?raw";
import { desktopApi } from "../desktopApi";
import type { WorkspaceDelta } from "../desktopApi/types";
import { classifyFileChange } from "../externalFileChange";
import {
	CHANGELOG_PATH,
	isChangelogPath,
	prepareChangelogMarkdown,
} from "../lib/changelogNote";
import { takeLatest } from "../lib/concurrency";
import {
	absoluteWorkspacePath,
	basename,
	dirname,
	extname,
	fileKindForPath,
	hasMarkdownExtension,
	isCodeFile,
	isEditableFile,
	joinPath,
	markdownAssetFolderPath,
	normalizePath,
	pathEquals,
	pathInFolder,
	relativeWorkspacePath,
	replacePathPrefix,
} from "../lib/filePath";
import {
	indexMovedFiles,
	type MovedFile,
	movedMarkdownFiles,
	pathAfterMove,
	rewriteMovedLinks,
} from "../lib/markdownLinkRewrite";
import {
	setThemePreference as applyThemePreference,
	initTheme,
	type ThemePreference,
} from "../theme";
import {
	activeHistory,
	canGoBack,
	canGoForward,
	clearHistory,
	normalizeStack,
	pruneHistory,
	pushHistory,
	rewriteHistory,
	setHistory,
} from "./history";
import type { CodeFileOpenMode, TerminalPosition } from "./persistence";
import { DEFAULT_CHAT_COMMAND } from "./settings";
import {
	applyFileAction,
	appStore,
	chatCommandStore,
	cleanFileState,
	codeFileOpenModeStore,
	emptyDoc,
	type FileEntry,
	type FolderEntry,
	getBaseline,
	historyStore,
	isInWorkspace,
	LOADING_DELAY_MS,
	lastSeenVersionStore,
	MAX_RECENT,
	pendingTerminalCommandStore,
	reviewThreadsStore,
	type SortMode,
	sidebarOpenStore,
	switcherOpenStore,
	themePreferenceStore,
	uiStore,
	type ViewMode,
	viewerStore,
	withOpenedDoc,
	workspaceStore,
} from "./state";
import { applyWorkspaceDelta } from "./workspaceDelta";

const REFRESH_FILES_DEBOUNCE_MS = 250;
const SELF_SAVE_TTL_MS = 5000;
const missingPathErrorPattern = /\bENOENT\b|\bENOTDIR\b/;
let refreshFilesTimer: ReturnType<typeof setTimeout> | null = null;
type RefreshRun = {
	reloadActive: boolean;
	promise: Promise<void>;
};
const refreshFilesInFlight = new Map<string, RefreshRun>();
const workspaceSidebarQueues = new Map<string, Promise<void>>();
// The active-file watcher also sees Hubble's own writes. If save A reaches disk
// after the editor already has draft B, that watcher event is not an external
// conflict; it is just the disk baseline catching up to a save we started.
const selfSaves = new Map<string, Map<string, number>>();
const DELETE_UNDO_DURATION_MS = 8000;
let blockedSaveItems: SidebarDeleteItem[] | null = null;

type PendingDeleteUndo = {
	token: string;
	workspacePath: string;
	reopenPath: string | null;
	removedPins: string[];
	removedLastOpened: Record<string, string>;
	historyBefore: ReturnType<typeof historyStore.get>;
	historyAfter: ReturnType<typeof historyStore.get>;
	pinRemovalSaved: Promise<void>;
	toastId: string | number | null;
	isRestoring: boolean;
};

let pendingDeleteUndo: PendingDeleteUndo | null = null;
let deleteInFlight = false;

type SidebarMoveItem =
	| { kind: "file"; path: string }
	| { kind: "folder"; folderId: string };

function deleteItemPath(item: SidebarDeleteItem) {
	return item.kind === "file" ? item.path : item.folderId;
}

function pathCoveredByDeleteItems(path: string, items: SidebarDeleteItem[]) {
	return items.some((item) =>
		item.kind === "file"
			? item.path === path
			: item.folderId === path || pathInFolder(path, item.folderId),
	);
}

function isStagedForDelete(path: string) {
	return blockedSaveItems
		? pathCoveredByDeleteItems(path, blockedSaveItems)
		: false;
}

function enqueueWorkspaceSidebarUpdate(
	workspacePath: string,
	update: () => Promise<void>,
) {
	const previous = workspaceSidebarQueues.get(workspacePath);
	const updatePromise = previous ? previous.then(update) : update();
	const queue = updatePromise.catch((error) => {
		console.error("Workspace sidebar update failed:", error);
	});
	workspaceSidebarQueues.set(workspacePath, queue);
	void queue.then(() => {
		if (workspaceSidebarQueues.get(workspacePath) === queue) {
			workspaceSidebarQueues.delete(workspacePath);
		}
	});
	return updatePromise;
}

async function refreshFilesNow(
	path: string,
	options: { reloadActive: boolean },
) {
	let listing: { files: FileEntry[]; folders: FolderEntry[] };
	try {
		listing = await desktopApi.listDirectory(path);
	} catch (err) {
		toast.error("Failed to refresh folder", {
			description: errorMessage(err),
		});
		return;
	}
	workspaceStore.set((state) => {
		if (state.workspacePath !== path) return state;
		return { ...state, files: listing.files, folders: listing.folders };
	});

	const currentPath = viewerStore.get().currentPath;
	if (
		!options.reloadActive ||
		workspaceStore.get().workspacePath !== path ||
		!currentPath ||
		isChangelogPath(currentPath) ||
		!isEditableFile(currentPath) ||
		!isInWorkspace(currentPath, path)
	) {
		return;
	}
	try {
		const nextContent = await desktopApi.readFileText(currentPath);
		handleExternalFileChange(currentPath, nextContent);
	} catch (err) {
		toast.error("Failed to refresh active note", {
			description: errorMessage(err),
		});
	}
}

export async function refreshFiles(
	path = workspaceStore.get().workspacePath,
	options?: { reloadActive?: boolean },
) {
	if (!path) return;
	const pending = refreshFilesInFlight.get(path);
	if (pending) {
		// A full refresh must not lose the active-note reload by joining a list-only one.
		pending.reloadActive ||= options?.reloadActive !== false;
		return pending.promise;
	}

	const run: RefreshRun = {
		reloadActive: options?.reloadActive !== false,
		promise: Promise.resolve(),
	};
	run.promise = enqueueWorkspaceSidebarUpdate(path, () =>
		refreshFilesNow(path, run),
	);
	refreshFilesInFlight.set(path, run);
	try {
		await run.promise;
	} finally {
		refreshFilesInFlight.delete(path);
	}
}

// Mutations already update or clear the active document themselves.
export function refreshFileList(path = workspaceStore.get().workspacePath) {
	return refreshFiles(path, { reloadActive: false });
}

export async function reconcileWorkspacePath(
	workspacePath: string,
	changedPath: string,
) {
	return enqueueWorkspaceSidebarUpdate(workspacePath, async () => {
		let delta: WorkspaceDelta | null;
		try {
			delta = await desktopApi.sidebarDeltaForPath(workspacePath, changedPath);
		} catch {
			return;
		}
		if (!delta || workspaceStore.get().workspacePath !== workspacePath) return;
		if (delta.kind === "refresh") {
			await refreshFilesNow(workspacePath, { reloadActive: false });
			return;
		}
		workspaceStore.set((state) => {
			if (state.workspacePath !== workspacePath) return state;
			const nextSidebar = applyWorkspaceDelta(state, delta);
			return { ...state, ...nextSidebar };
		});
	});
}
/**
 * Debounced wrapper for event-driven sidebar refreshes.
 *
 * Keep `refreshFiles()` immediate for user actions that await a fresh snapshot.
 * Prefer debounced for refreshes triggered by effects.
 */
export function refreshFilesDebounced(
	path = workspaceStore.get().workspacePath,
) {
	if (!path) return;
	if (refreshFilesTimer !== null) clearTimeout(refreshFilesTimer);
	refreshFilesTimer = setTimeout(() => {
		refreshFilesTimer = null;
		void refreshFiles(path);
	}, REFRESH_FILES_DEBOUNCE_MS);
}

function errorMessage(err: unknown) {
	return err instanceof Error ? err.message : String(err);
}

function refreshFilesAfterMissingPath(message: string) {
	if (!missingPathErrorPattern.test(message)) return;
	// Missing files usually mean the sidebar snapshot is stale because Hubble no
	// longer watches the whole workspace.
	refreshFilesDebounced();
}

function handleFileError(err: unknown) {
	const message = errorMessage(err);
	refreshFilesAfterMissingPath(message);
	return message;
}

function pruneSelfSaves(path: string, now = Date.now()) {
	const contents = selfSaves.get(path);
	if (!contents) return;
	for (const [content, expiresAt] of contents) {
		if (expiresAt <= now) contents.delete(content);
	}
	if (contents.size === 0) selfSaves.delete(path);
}

function rememberSelfSave(path: string, content: string) {
	pruneSelfSaves(path);
	const contents = selfSaves.get(path) ?? new Map<string, number>();
	contents.set(content, Date.now() + SELF_SAVE_TTL_MS);
	selfSaves.set(path, contents);
}

function isSelfSave(path: string, content: string) {
	pruneSelfSaves(path);
	return selfSaves.get(path)?.has(content) ?? false;
}

function selfSaveState(editorContent: string, diskContent: string) {
	if (editorContent === diskContent) {
		return cleanFileState(diskContent);
	}
	// Keep newer editor text intact while acknowledging that an older self-save
	// is now the latest content known to be on disk.
	return {
		diskContent,
		externalChange: { kind: "none" as const },
		status: "ready" as const,
		error: null,
	};
}

function pathStartsWithFolder(filePath: string, folderPath: string): boolean {
	return pathEquals(filePath, folderPath) || pathInFolder(filePath, folderPath);
}

function moveAffectsPath(path: string, sourcePath: string, isFolder: boolean) {
	return isFolder
		? pathStartsWithFolder(path, sourcePath)
		: pathEquals(path, sourcePath);
}

function setViewerCleanContent(path: string, content: string) {
	viewerStore.set((state) => {
		if (state.currentPath !== path) return state;
		return {
			...state,
			...cleanFileState(content),
		};
	});
}

async function writeFileIfChanged(path: string, current: string, next: string) {
	if (next === current) return false;
	await desktopApi.writeFileText(path, next);
	setViewerCleanContent(path, next);
	return true;
}

async function moveAssociatedAssetFolder(
	fromFilePath: string,
	toFilePath: string,
) {
	if (!hasMarkdownExtension(fromFilePath)) return null;
	const fromAssetFolder = markdownAssetFolderPath(fromFilePath);
	const toAssetFolder = markdownAssetFolderPath(toFilePath);
	if (
		!fromAssetFolder ||
		!toAssetFolder ||
		pathEquals(fromAssetFolder, toAssetFolder)
	) {
		return null;
	}
	// Asset folders are optional; check first so Electron does not log a
	// rejected rename for normal notes without assets.
	if (!(await desktopApi.pathExists(fromAssetFolder))) return null;
	try {
		await desktopApi.renameFile(fromAssetFolder, toAssetFolder);
		return { fromPath: fromAssetFolder, toPath: toAssetFolder };
	} catch (err) {
		if (missingPathErrorPattern.test(errorMessage(err))) return null;
		throw err;
	}
}

/**
 * Updates Markdown and wiki links after sidebar rename/move operations.
 *
 * Each file is processed once. Links are resolved from the file's old path, then
 * written relative to its new path so folder moves and file moves share one path.
 */
async function updateMovedLinks(movedFiles: MovedFile[], files: FileEntry[]) {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath || movedFiles.length === 0) return;
	const movedByOldPath = indexMovedFiles(movedFiles);
	const current = viewerStore.get();

	for (const file of files.filter((file) => hasMarkdownExtension(file.path))) {
		const nextPath = pathAfterMove(file.path, movedByOldPath);
		try {
			// The open editor may have unsaved changes, so disk content is stale for
			// that file. Rewrite from the draft and then save that rewritten draft.
			const content = pathEquals(current.currentPath ?? "", nextPath)
				? current.content
				: await desktopApi.readFileText(nextPath);
			const nextContent = rewriteMovedLinks({
				content,
				filePath: file.path,
				nextPath,
				workspacePath,
				movedByOldPath,
			});
			await writeFileIfChanged(nextPath, content, nextContent);
		} catch (err) {
			const message = handleFileError(err);
			toast.error("Failed to update links", { description: message });
		}
	}
}

function folderPathsFromEntries(
	files: FileEntry[],
	folderEntries: FolderEntry[] = [],
) {
	const folderPaths = new Set<string>();
	for (const folder of folderEntries) {
		folderPaths.add(folder.path.toLocaleLowerCase());
	}
	for (const file of files) {
		let parent = dirname(file.path);
		while (parent) {
			folderPaths.add(parent.toLocaleLowerCase());
			const nextParent = dirname(parent);
			parent = nextParent === parent ? null : nextParent;
		}
	}
	return folderPaths;
}

function uniqueMovePath(parent: string, sourcePath: string, isFolder: boolean) {
	const sourceName = basename(sourcePath);
	const extension = isFolder ? "" : extname(sourceName);
	const stem = extension ? sourceName.slice(0, -extension.length) : sourceName;
	const { files, folders } = workspaceStore.get();
	const existing = new Set([
		...files.map((file) => file.path.toLocaleLowerCase()),
		...folderPathsFromEntries(files, folders),
	]);
	for (let index = 0; ; index++) {
		const name = index === 0 ? sourceName : `${stem} ${index}${extension}`;
		const candidate = joinPath(parent, name);
		if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

async function loadPinnedNotes(workspacePath: string) {
	const config = await desktopApi.readWorkspaceConfig(workspacePath);
	workspaceStore.set((state) => {
		if (state.workspacePath !== workspacePath) return state;
		return {
			...state,
			pinnedNotes: config.pinnedNotes.map((note) =>
				absoluteWorkspacePath(note, workspacePath),
			),
		};
	});
}

async function writePinnedNotes(workspacePath: string, pinnedNotes: string[]) {
	await desktopApi.writeWorkspaceConfig(workspacePath, {
		version: 1,
		pinnedNotes: pinnedNotes.map((note) =>
			relativeWorkspacePath(note, workspacePath),
		),
	});
}

async function syncPinnedNotes() {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath) return;
	try {
		await writePinnedNotes(workspacePath, workspaceStore.get().pinnedNotes);
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to update pinned notes", { description: message });
	}
}

export function touchFile(path: string) {
	workspaceStore.set((state) => {
		if (!isInWorkspace(path, state.workspacePath)) return state;
		return {
			...state,
			files: state.files.map((file) =>
				file.path === path
					? { ...file, modified_at: Math.floor(Date.now() / 1000) }
					: file,
			),
		};
	});
}

function uniqueFilePath(
	parent: string,
	stem: string,
	extension: string,
): string {
	const files = workspaceStore.get().files;
	const existing = new Set(files.map((file) => file.path.toLocaleLowerCase()));
	for (let index = 1; ; index++) {
		const name =
			index === 1 ? `${stem}${extension}` : `${stem}-${index}${extension}`;
		const candidate = joinPath(parent, name);
		if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

function uniqueFolderPath(parent: string): string {
	const { files, folders } = workspaceStore.get();
	const existing = new Set([
		...files.map((file) => file.path.toLocaleLowerCase()),
		...folderPathsFromEntries(files, folders),
	]);
	for (let index = 1; ; index++) {
		const name = index === 1 ? "new-folder" : `new-folder-${index}`;
		const candidate = joinPath(parent, name);
		if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

const pendingRenames = new Map<string, string>();

type LoadPathOptions = {
	history?: "push" | "none";
	missing?: "toast" | "silent";
	/** `false` keeps code files in Hubble regardless of the default-app preference. */
	launchExternal?: boolean;
};

export function getPendingRenameTarget(path: string) {
	return pendingRenames.get(path) ?? null;
}

if (workspaceStore.get().workspacePath) {
	void refreshFiles();
}

export function setSortMode(mode: SortMode) {
	workspaceStore.select("sortMode").set(mode);
}

export function setWorkspaceSwitcherOpen(isOpen: boolean) {
	switcherOpenStore.set(isOpen);
}

export function setSidebarOpen(isOpen: boolean) {
	sidebarOpenStore.set(isOpen);
}

export function toggleSidebar() {
	sidebarOpenStore.set((open) => !open);
}

export function setTerminalOpen(isOpen: boolean) {
	uiStore.select("isTerminalOpen").set(isOpen);
}

export function toggleTerminal() {
	uiStore.select("isTerminalOpen").set((open) => !open);
}

export function setTerminalPosition(position: TerminalPosition) {
	uiStore.select("terminalPosition").set(position);
}

export function setChatCommand(command: string) {
	chatCommandStore.set(command);
}

export function setCodeFileOpenMode(mode: CodeFileOpenMode) {
	codeFileOpenModeStore.set(mode);
}

export async function openPathInDefaultApp(path: string) {
	try {
		await desktopApi.openPathInDefaultApp(path);
	} catch (err) {
		toast.error("Failed to open file", {
			description: handleFileError(err),
		});
	}
}

export function setLastSeenVersion(version: string) {
	lastSeenVersionStore.set(version);
}

export function initThemePreference() {
	const preference = themePreferenceStore.get();
	initTheme(preference);
	syncNativeTheme(preference);
}

export function setThemePreference(preference: ThemePreference) {
	themePreferenceStore.set(preference);
	if (preference !== "system") applyThemePreference(preference);
	syncNativeTheme(preference);
}

/**
 * Hands the preference to the Electron main process, which forces it through
 * `nativeTheme.themeSource` so native window chrome and sandboxed HTML apps
 * follow it too.
 *
 * While a Light or Dark override is in force, Chromium reports that override to
 * `prefers-color-scheme` instead of the real OS appearance. So the OS value is
 * only readable after the main process drops the override, and dropping it fires
 * no `change` event. That is why `"system"` waits and then applies itself.
 */
function syncNativeTheme(preference: ThemePreference) {
	const updated = desktopApi.setThemeSource(preference);
	if (preference !== "system") return;
	void updated.then(() => {
		// A newer explicit pick already applied itself while this was in flight.
		if (themePreferenceStore.get() === "system") {
			applyThemePreference("system");
		}
	});
}

export function requestChatAboutNote() {
	if (isChangelogPath(viewerStore.get().currentPath)) return;
	const command = chatCommandStore.get().trim() || DEFAULT_CHAT_COMMAND;
	// Set the command before opening so the panel's open effect can see it
	// and defer to the chat launch instead of starting a plain session.
	pendingTerminalCommandStore.set(command);
	uiStore.select("isTerminalOpen").set(true);
}

export function clearPendingTerminalCommand() {
	uiStore.set((state) => ({ ...state, pendingTerminalCommand: null }));
}

export function clearViewer() {
	viewerStore.set((state) => emptyDoc(state.lastOpenedPath));
}

/** Opens a workspace and reveals the sidebar. */
export async function openWorkspaceWithSidebar() {
	await openWorkspace();
	if (workspaceStore.get().workspacePath !== null) {
		sidebarOpenStore.set(true);
	}
}

/** Creates a new folder, opens it as a workspace, and reveals the sidebar. */
export async function createWorkspaceWithSidebar() {
	const created = await desktopApi.createFolderPicker();
	if (typeof created !== "string") return;
	await openWorkspace(created);
	if (workspaceStore.get().workspacePath !== null) {
		sidebarOpenStore.set(true);
	}
}

/** Forgets an inactive folder from recents without changing its saved file state. */
export function removeRecentWorkspace(path: string) {
	workspaceStore.set((state) => {
		if (
			state.workspacePath === path ||
			!state.recentWorkspaces.includes(path)
		) {
			return state;
		}
		return {
			...state,
			recentWorkspaces: state.recentWorkspaces.filter(
				(recentPath) => recentPath !== path,
			),
		};
	});
}

/** Opens a workspace by path. If no path given, shows a folder picker first. */
export async function openWorkspace(path?: string) {
	let nextPath = path;
	if (!nextPath) {
		const selected = await desktopApi.openFolderPicker();
		if (typeof selected !== "string") return;
		nextPath = selected;
	}
	if (workspaceStore.get().workspacePath !== nextPath) {
		await finalizePendingDeleteUndo();
	}

	workspaceStore.set((state) => {
		const filtered = state.recentWorkspaces.filter((p) => p !== nextPath);
		return {
			...state,
			workspacePath: nextPath,
			recentWorkspaces: [nextPath, ...filtered].slice(0, MAX_RECENT),
			files: [],
			pinnedNotes: [],
		};
	});
	switcherOpenStore.set(false);
	await Promise.all([refreshFileList(nextPath), loadPinnedNotes(nextPath)]);

	const lastFile = workspaceStore.get().lastOpenedPaths[nextPath];
	if (lastFile) {
		await loadPath(lastFile, { missing: "silent", launchExternal: false });
		return;
	}

	clearViewer();
}

export function updateEditorContent(path: string, content: string) {
	const current = viewerStore.get();
	if (current.currentPath !== path || current.content === content) return;
	void finalizePendingDeleteUndo();

	viewerStore.set((state) => {
		if (state.currentPath !== path) return state;
		if (
			state.externalChange.kind === "conflict" &&
			content === state.externalChange.diskContent
		) {
			return {
				...state,
				...cleanFileState(content),
			};
		}
		return {
			...state,
			content,
			status: "ready",
			error: null,
		};
	});
}

export function setViewerMode(viewMode: ViewMode) {
	viewerStore.set((state) => {
		if (state.viewMode === viewMode) return state;
		return { ...state, viewMode };
	});
}

export async function savePathContent(
	path: string,
	content: string,
	options?: { force?: boolean; throwOnError?: boolean },
) {
	// Binary viewers, external files, and the virtual changelog never enter text saves.
	if (isChangelogPath(path) || !isEditableFile(path)) return;
	// A save already queued by the editor must not recreate a staged deletion.
	if (isStagedForDelete(path)) return;
	const current = viewerStore.get();
	const force = options?.force === true;
	if (current.currentPath !== path) return;
	if (!force && current.externalChange.kind === "conflict") return;
	if (!force && current.content === content && content === getBaseline(current))
		return;

	if (!force) {
		try {
			const currentDiskContent = await desktopApi.readFileText(path);
			const nextCurrent = viewerStore.get();
			if (nextCurrent.currentPath !== path) return;
			if (isSelfSave(path, currentDiskContent)) {
				viewerStore.set((state) => {
					if (state.currentPath !== path) return state;
					return {
						...state,
						...selfSaveState(state.content, currentDiskContent),
					};
				});
			} else {
				const action = classifyFileChange({
					editorContent: nextCurrent.content,
					baseline: getBaseline(nextCurrent),
					diskContent: currentDiskContent,
				});
				if (action !== "none") {
					viewerStore.set((state) => {
						if (state.currentPath !== path) return state;
						return applyFileAction(state, currentDiskContent, action);
					});
					return;
				}
			}
		} catch {
			// Fall through to the write path if the file cannot be read during preflight.
		}
	}

	try {
		rememberSelfSave(path, content);
		await desktopApi.writeFileText(path, content);
		rememberSelfSave(path, content);
		touchFile(path);
		viewerStore.set((state) => {
			if (state.currentPath !== path) return state;
			if (!force && state.externalChange.kind === "conflict") return state;
			// Only write the saved text back into live editor content if the user
			// has not typed more while the save was in flight. Otherwise, just
			// move the saved baseline forward and keep the newer editor text.
			if (state.content === content) {
				return {
					...state,
					...cleanFileState(content),
				};
			}
			return {
				...state,
				diskContent: content,
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			};
		});
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to save file", { description: message });
		viewerStore.set((state) => {
			if (state.currentPath !== path) return state;
			return {
				...state,
				status: "error",
				error: message,
			};
		});
		if (options?.throwOnError) throw err;
	}
}

export async function renameMarkdownFile(path: string, nextName: string) {
	const current = viewerStore.get();
	const isCurrentFile = current.currentPath === path;
	const { files: filesBeforeRename, workspacePath } = workspaceStore.get();

	const trimmedName = nextName.trim();
	if (trimmedName.length === 0) return;

	const parent = dirname(path);
	if (!parent) return;

	const currentExt = extname(path);
	const proposedExt = extname(trimmedName);
	const proposedStem =
		proposedExt.length > 0 &&
		proposedExt.toLocaleLowerCase() === currentExt.toLocaleLowerCase()
			? trimmedName.slice(0, -proposedExt.length)
			: trimmedName;
	const nextNameWithExt = `${proposedStem}${currentExt}`;
	// Slash paths are relative to the current file's folder, matching sidebar
	// rename behavior for nested notes.
	const nextPath = normalizePath(joinPath(parent, nextNameWithExt));
	if (!isSafeRelativeRenamePath(trimmedName, nextPath, workspacePath)) return;
	if (nextPath === path) return;

	try {
		if (isCurrentFile && isEditableFile(path)) {
			await savePathContent(path, current.content, { force: true });
		}
		pendingRenames.set(path, nextPath);
		await desktopApi.renameFile(path, nextPath);
		const movedAssetFolder = await moveAssociatedAssetFolder(path, nextPath);
		const movedFiles = [{ fromPath: path, toPath: nextPath }];
		if (movedAssetFolder) movedFiles.push(movedAssetFolder);
		await updateMovedLinks(movedFiles, filesBeforeRename);
		rewriteHistory(path, nextPath);
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.map((file) =>
					file.path === path ? { ...file, path: nextPath } : file,
				),
				pinnedNotes: state.workspace.pinnedNotes.map((pinnedPath) =>
					pinnedPath === path ? nextPath : pinnedPath,
				),
				lastOpenedPaths: Object.fromEntries(
					Object.entries(state.workspace.lastOpenedPaths).map(
						([workspacePath, openedPath]) => [
							workspacePath,
							openedPath === path ? nextPath : openedPath,
						],
					),
				),
			},
			document: {
				...state.document,
				currentPath:
					state.document.currentPath === path
						? nextPath
						: state.document.currentPath,
				lastOpenedPath:
					state.document.lastOpenedPath === path
						? nextPath
						: state.document.lastOpenedPath,
			},
		}));
		await syncPinnedNotes();
		await refreshFileList();
		if (isCurrentFile) {
			// Path rewrite already updated history; reload content without a new visit.
			await loadPath(nextPath, { history: "none", launchExternal: false });
		}
	} catch (err) {
		pendingRenames.delete(path);
		const message = handleFileError(err);
		toast.error("Failed to rename file", { description: message });
	} finally {
		window.setTimeout(() => pendingRenames.delete(path), 1000);
	}
}

export async function renameCurrentMarkdownFile(nextName: string) {
	const current = viewerStore.get();
	if (!current.currentPath || isChangelogPath(current.currentPath)) return;
	await renameMarkdownFile(current.currentPath, nextName);
}

async function deleteEmptySourceAncestors(
	sourcePath: string,
	targetPath: string,
	workspacePath: string | null,
) {
	if (!workspacePath) return;
	let parent = dirname(sourcePath);
	while (parent && !pathEquals(parent, workspacePath)) {
		if (pathEquals(parent, targetPath) || pathInFolder(targetPath, parent)) {
			return;
		}
		try {
			await desktopApi.deleteFile(parent);
		} catch (err) {
			const message = errorMessage(err);
			if (
				!missingPathErrorPattern.test(message) &&
				!/\bENOTEMPTY\b/.test(message)
			) {
				throw err;
			}
			return;
		}
		const nextParent = dirname(parent);
		parent = nextParent === parent ? null : nextParent;
	}
}

export async function renameFolder(
	path: string,
	nextName: string,
	targetPath?: string,
) {
	const { files: filesBeforeRename, workspacePath } = workspaceStore.get();
	const trimmedName = nextName.trim();
	if (trimmedName.length === 0) return;

	const parent = dirname(path);
	if (!parent) return;

	const nextPath = normalizePath(targetPath ?? joinPath(parent, trimmedName));
	if (
		targetPath &&
		workspacePath &&
		!pathInFolder(nextPath, normalizePath(workspacePath))
	) {
		return;
	}
	if (!isSafeRelativeRenamePath(trimmedName, nextPath, workspacePath)) return;
	if (nextPath === path) return;

	const current = viewerStore.get();
	const currentPath = current.currentPath;
	const currentAffected = currentPath && pathInFolder(currentPath, path);
	const movedFiles = movedMarkdownFiles(
		filesBeforeRename,
		path,
		nextPath,
		true,
	);

	try {
		if (currentAffected && currentPath && isEditableFile(currentPath)) {
			await savePathContent(currentPath, current.content, { force: true });
		}
		await desktopApi.renameFile(path, nextPath);
		await deleteEmptySourceAncestors(path, nextPath, workspacePath);
		rewriteHistory(path, nextPath, true);
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.map((file) => ({
					...file,
					path: replacePathPrefix(file.path, path, nextPath),
				})),
				folders: state.workspace.folders.map((folder) => ({
					...folder,
					path: replacePathPrefix(folder.path, path, nextPath),
				})),
				pinnedNotes: state.workspace.pinnedNotes.map((pinnedPath) =>
					replacePathPrefix(pinnedPath, path, nextPath),
				),
				lastOpenedPaths: Object.fromEntries(
					Object.entries(state.workspace.lastOpenedPaths).map(
						([workspace, openedPath]) => [
							workspace,
							replacePathPrefix(openedPath, path, nextPath),
						],
					),
				),
			},
			document: {
				...state.document,
				currentPath: state.document.currentPath
					? replacePathPrefix(state.document.currentPath, path, nextPath)
					: null,
				lastOpenedPath: state.document.lastOpenedPath
					? replacePathPrefix(state.document.lastOpenedPath, path, nextPath)
					: null,
			},
		}));
		await updateMovedLinks(movedFiles, filesBeforeRename);
		await syncPinnedNotes();
		await refreshFileList();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to rename folder", { description: message });
		await refreshFileList();
	}
}

function isSafeRelativeRenamePath(
	name: string,
	nextPath: string,
	workspacePath: string | null,
) {
	if (!/[\\/]/.test(name)) return true;
	if (!workspacePath) return false;
	if (
		name.startsWith("/") ||
		name.startsWith("\\") ||
		/^[a-zA-Z]:[\\/]/.test(name)
	) {
		return false;
	}
	const normalized = normalizePath(name);
	if (
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../")
	) {
		return false;
	}
	return pathInFolder(nextPath, normalizePath(workspacePath));
}

export async function moveSidebarItem(
	item: SidebarMoveItem,
	targetFolderPath: string,
) {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath) return;
	const filesBeforeMove = workspaceStore.get().files;
	const sourcePath =
		item.kind === "file"
			? item.path
			: absoluteWorkspacePath(
					item.folderId.replace(/[\\/]+$/, ""),
					workspacePath,
				);
	const isFolder = item.kind === "folder";
	const sourceParent = dirname(sourcePath);
	if (!sourceParent) return;
	if (pathEquals(sourceParent, targetFolderPath)) return;
	if (isFolder && pathStartsWithFolder(targetFolderPath, sourcePath)) return;

	const current = viewerStore.get();
	const currentPath = current.currentPath;
	const currentAffected =
		currentPath && moveAffectsPath(currentPath, sourcePath, isFolder);
	const nextPath = uniqueMovePath(targetFolderPath, sourcePath, isFolder);
	const movedFiles = movedMarkdownFiles(
		filesBeforeMove,
		sourcePath,
		nextPath,
		isFolder,
	);

	try {
		if (currentAffected && currentPath && isEditableFile(currentPath)) {
			await savePathContent(currentPath, current.content, { force: true });
		}
		await desktopApi.renameFile(sourcePath, nextPath);
		const movedAssetFolder =
			item.kind === "file"
				? await moveAssociatedAssetFolder(sourcePath, nextPath)
				: null;
		rewriteHistory(sourcePath, nextPath, isFolder);
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.map((file) => ({
					...file,
					path: replacePathPrefix(file.path, sourcePath, nextPath),
				})),
				pinnedNotes: state.workspace.pinnedNotes.map((pinnedPath) =>
					replacePathPrefix(pinnedPath, sourcePath, nextPath),
				),
				lastOpenedPaths: Object.fromEntries(
					Object.entries(state.workspace.lastOpenedPaths).map(
						([workspace, openedPath]) => [
							workspace,
							replacePathPrefix(openedPath, sourcePath, nextPath),
						],
					),
				),
			},
			document: {
				...state.document,
				currentPath: state.document.currentPath
					? replacePathPrefix(state.document.currentPath, sourcePath, nextPath)
					: null,
				lastOpenedPath: state.document.lastOpenedPath
					? replacePathPrefix(
							state.document.lastOpenedPath,
							sourcePath,
							nextPath,
						)
					: null,
			},
		}));
		if (movedAssetFolder) movedFiles.push(movedAssetFolder);
		await updateMovedLinks(movedFiles, filesBeforeMove);
		await syncPinnedNotes();
		await refreshFileList();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to move item", { description: message });
		await refreshFileList();
	}
}

export async function moveSidebarItems(
	items: SidebarMoveItem[],
	targetFolderPath: string,
) {
	for (const item of items) {
		await moveSidebarItem(item, targetFolderPath);
	}
}

async function createEmptyFileInFolder(
	parentPath: string,
	stem: string,
	extension: string,
) {
	const path = uniqueFilePath(parentPath, stem, extension);
	try {
		await desktopApi.writeFileText(path, "");
		const modified_at = Math.floor(Date.now() / 1000);
		workspaceStore.set((state) => ({
			...state,
			files: [
				...state.files,
				{ path, modified_at, kind: fileKindForPath(path) },
			],
		}));
		await loadPath(path);
		await refreshFileList();
		return path;
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to create file", { description: message });
		return null;
	}
}

export function createMarkdownFileInFolder(parentPath: string) {
	return createEmptyFileInFolder(parentPath, "new-file", ".md");
}

export function createHtmlFileInFolder(parentPath: string) {
	return createEmptyFileInFolder(parentPath, "new-app", ".html");
}

export async function createFolderInFolder(parentPath: string) {
	const path = uniqueFolderPath(parentPath);
	try {
		await desktopApi.createFolder(path);
		const modified_at = Math.floor(Date.now() / 1000);
		workspaceStore.set((state) => ({
			...state,
			folders: [...state.folders, { path, modified_at }],
		}));
		await refreshFileList();
		return path;
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to create folder", { description: message });
		return null;
	}
}

export async function deleteMarkdownFile(
	path: string,
	options?: { throwOnError?: boolean },
) {
	try {
		await desktopApi.deleteFile(path);
		const wasCurrentFile = viewerStore.get().currentPath === path;
		if (wasCurrentFile) {
			clearHistory();
		} else {
			pruneHistory(path);
		}
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.filter((file) => file.path !== path),
				pinnedNotes: state.workspace.pinnedNotes.filter(
					(pinnedPath) => pinnedPath !== path,
				),
				lastOpenedPaths: Object.fromEntries(
					Object.entries(state.workspace.lastOpenedPaths).filter(
						([, openedPath]) => openedPath !== path,
					),
				),
			},
			document:
				state.document.currentPath === path
					? emptyDoc(
							state.document.lastOpenedPath === path
								? null
								: state.document.lastOpenedPath,
						)
					: {
							...state.document,
							lastOpenedPath:
								state.document.lastOpenedPath === path
									? null
									: state.document.lastOpenedPath,
						},
		}));
		await syncPinnedNotes();
		await refreshFileList();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to delete file", { description: message });
		if (options?.throwOnError) throw err;
	}
}

export async function deleteFolder(path: string) {
	try {
		await desktopApi.deleteFile(path, { recursive: true });
		const currentPath = viewerStore.get().currentPath;
		if (currentPath && pathInFolder(currentPath, path)) {
			clearHistory();
		} else {
			pruneHistory(path, true);
		}
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.filter(
					(file) => !pathInFolder(file.path, path),
				),
				pinnedNotes: state.workspace.pinnedNotes.filter(
					(pinnedPath) => !pathInFolder(pinnedPath, path),
				),
				lastOpenedPaths: Object.fromEntries(
					Object.entries(state.workspace.lastOpenedPaths).filter(
						([, openedPath]) => !pathInFolder(openedPath, path),
					),
				),
			},
			document:
				state.document.currentPath &&
				pathInFolder(state.document.currentPath, path)
					? emptyDoc(
							state.document.lastOpenedPath &&
								pathInFolder(state.document.lastOpenedPath, path)
								? null
								: state.document.lastOpenedPath,
						)
					: {
							...state.document,
							lastOpenedPath:
								state.document.lastOpenedPath &&
								pathInFolder(state.document.lastOpenedPath, path)
									? null
									: state.document.lastOpenedPath,
						},
		}));
		await syncPinnedNotes();
		await refreshFileList();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to delete folder", { description: message });
	}
}

function clearPendingDelete(pending: PendingDeleteUndo) {
	pendingDeleteUndo = null;
	blockedSaveItems = null;
	if (pending.toastId !== null) toast.dismiss(pending.toastId);
	void desktopApi.setDeleteUndoAvailable(false);
}

export async function finalizePendingDeleteUndo(token?: string) {
	const pending = pendingDeleteUndo;
	if (!pending || pending.isRestoring || (token && pending.token !== token)) {
		return false;
	}
	try {
		await pending.pinRemovalSaved;
		await desktopApi.finalizeDelete(pending.token);
	} catch (error) {
		toast.error("Failed to finish deleting items", {
			description: handleFileError(error),
		});
	}
	clearPendingDelete(pending);
	return true;
}

export async function undoPendingDelete(token?: string) {
	const pending = pendingDeleteUndo;
	if (!pending || pending.isRestoring || (token && pending.token !== token)) {
		return false;
	}
	pending.isRestoring = true;
	try {
		// Finish the removal write so it cannot overwrite the restored pins.
		await pending.pinRemovalSaved;
		await desktopApi.restoreDelete(pending.token);
	} catch (error) {
		clearPendingDelete(pending);
		toast.error("Failed to undo deletion", {
			description: handleFileError(error),
		});
		return false;
	}

	clearPendingDelete(pending);
	const currentWorkspace = workspaceStore.get().workspacePath;
	if (currentWorkspace === pending.workspacePath) {
		workspaceStore.set((state) => ({
			...state,
			pinnedNotes: [...new Set([...state.pinnedNotes, ...pending.removedPins])],
			lastOpenedPaths: {
				...state.lastOpenedPaths,
				...pending.removedLastOpened,
			},
		}));
		if (historyStore.get() === pending.historyAfter) {
			historyStore.set(pending.historyBefore);
		}
		await refreshFiles(pending.workspacePath);
		if (pending.reopenPath && viewerStore.get().currentPath === null) {
			await loadPath(pending.reopenPath, {
				history: "none",
				launchExternal: false,
			});
		}
		await syncPinnedNotes();
	}
	return true;
}

async function performSidebarDelete(items: SidebarDeleteItem[]) {
	if (items.length === 0) return;
	await finalizePendingDeleteUndo();
	if (pendingDeleteUndo) return;

	const workspaceBefore = workspaceStore.get();
	if (!workspaceBefore.workspacePath) return;
	const viewerBefore = viewerStore.get();
	const historyBefore = historyStore.get();
	if (
		viewerBefore.currentPath &&
		pathCoveredByDeleteItems(viewerBefore.currentPath, items)
	) {
		try {
			await savePathContent(viewerBefore.currentPath, viewerBefore.content, {
				force: true,
				throwOnError: true,
			});
		} catch {
			return;
		}
	}
	blockedSaveItems = items;

	let token: string;
	try {
		token = await desktopApi.stageDelete(
			workspaceBefore.workspacePath,
			items.map(deleteItemPath),
		);
	} catch (error) {
		blockedSaveItems = null;
		toast.error("Failed to delete items", {
			description: handleFileError(error),
		});
		return;
	}
	if (workspaceStore.get().workspacePath !== workspaceBefore.workspacePath) {
		blockedSaveItems = null;
		await desktopApi.finalizeDelete(token);
		return;
	}

	const deletedPath = (candidate: string) =>
		pathCoveredByDeleteItems(candidate, items);
	const deletedCurrent =
		viewerBefore.currentPath !== null && deletedPath(viewerBefore.currentPath);
	const removedPins = workspaceBefore.pinnedNotes.filter(deletedPath);
	const removedLastOpened = Object.fromEntries(
		Object.entries(workspaceBefore.lastOpenedPaths).filter(([, path]) =>
			deletedPath(path),
		),
	);
	if (deletedCurrent) {
		clearHistory();
	} else {
		for (const item of items) {
			if (item.kind === "file") pruneHistory(item.path);
			else pruneHistory(item.folderId, true);
		}
	}
	appStore.set((state) => ({
		...state,
		workspace: {
			...state.workspace,
			files: state.workspace.files.filter((file) => !deletedPath(file.path)),
			folders: state.workspace.folders.filter(
				(folder) => !deletedPath(folder.path),
			),
			pinnedNotes: state.workspace.pinnedNotes.filter(
				(pin) => !deletedPath(pin),
			),
			lastOpenedPaths: Object.fromEntries(
				Object.entries(state.workspace.lastOpenedPaths).filter(
					([, openedPath]) => !deletedPath(openedPath),
				),
			),
		},
		document: deletedCurrent
			? emptyDoc(
					state.document.lastOpenedPath &&
						deletedPath(state.document.lastOpenedPath)
						? null
						: state.document.lastOpenedPath,
				)
			: {
					...state.document,
					lastOpenedPath:
						state.document.lastOpenedPath &&
						deletedPath(state.document.lastOpenedPath)
							? null
							: state.document.lastOpenedPath,
				},
	}));
	const pinRemovalSaved = syncPinnedNotes();
	pendingDeleteUndo = {
		token,
		workspacePath: workspaceBefore.workspacePath,
		reopenPath: deletedCurrent ? viewerBefore.currentPath : null,
		removedPins,
		removedLastOpened,
		historyBefore,
		historyAfter: historyStore.get(),
		pinRemovalSaved,
		toastId: null,
		isRestoring: false,
	};
	const count = items.length;
	const toastId = toast(
		`Deleted ${count === 1 ? "1 item" : `${count} items`}`,
		{
			duration: DELETE_UNDO_DURATION_MS,
			action: {
				label: `Undo ${formatShortcut("CmdOrCtrl+Z")}`,
				onClick: (event) => {
					event.preventDefault();
					void undoPendingDelete(token);
				},
			},
			onAutoClose: () => void finalizePendingDeleteUndo(token),
			onDismiss: () => void finalizePendingDeleteUndo(token),
		},
	);
	if (pendingDeleteUndo?.token === token) pendingDeleteUndo.toastId = toastId;
	await desktopApi.setDeleteUndoAvailable(true);
	await pinRemovalSaved;
}

export async function deleteSidebarItems(items: SidebarDeleteItem[]) {
	if (deleteInFlight) return;
	deleteInFlight = true;
	try {
		await performSidebarDelete(items);
	} finally {
		deleteInFlight = false;
	}
}

export function handleExternalFileChange(
	path: string,
	nextDiskContent: string,
) {
	viewerStore.set((state) => {
		if (state.currentPath !== path) return state;
		if (isSelfSave(path, nextDiskContent)) {
			return {
				...state,
				...selfSaveState(state.content, nextDiskContent),
			};
		}
		const action = classifyFileChange({
			editorContent: state.content,
			baseline: getBaseline(state),
			diskContent: nextDiskContent,
		});
		return applyFileAction(state, nextDiskContent, action);
	});
}

export function reloadFromDiskConflict() {
	viewerStore.set((state) => {
		if (state.externalChange.kind !== "conflict") return state;
		return {
			...state,
			...cleanFileState(state.externalChange.diskContent),
		};
	});
}

/** Force-writes the current editor content to disk, overwriting any external changes. */
export async function forceKeepLocalEdits() {
	const current = viewerStore.get();
	if (current.currentPath === null) return;
	await savePathContent(current.currentPath, current.content, { force: true });
}

const { run: loadInternalPath, invalidate: invalidateLoadPath } = takeLatest(
	async ({ isStale }, path: string, options?: LoadPathOptions) => {
		const historyMode = options?.history ?? "push";
		const missingMode = options?.missing ?? "toast";
		const fileKind = fileKindForPath(path);
		const timer = window.setTimeout(() => {
			if (isStale()) return;
			viewerStore.set((state) => ({
				...state,
				status: "loading",
				error: null,
			}));
		}, LOADING_DELAY_MS);

		try {
			let content = "";
			if (fileKind === "viewer") {
				if (!(await desktopApi.pathExists(path))) throw new Error("ENOENT");
			} else {
				content = await desktopApi.readFileText(path);
			}
			if (isStale()) return;
			appStore.set((state) => withOpenedDoc(state, path, content));
			if (historyMode === "push") pushHistory(path);
		} catch (err) {
			if (isStale()) return;
			const message = handleFileError(err);
			if (missingMode === "toast") {
				toast.error("Failed to open file", { description: message });
				// Stay on the current document; the toast is the only failure
				// surface. Only undo the delayed loading flip if it fired.
				viewerStore.set((state) =>
					state.status === "loading"
						? { ...state, status: state.currentPath ? "ready" : "idle" }
						: state,
				);
			} else {
				appStore.set((state) => ({
					...state,
					workspace: {
						...state.workspace,
						lastOpenedPaths: Object.fromEntries(
							Object.entries(state.workspace.lastOpenedPaths).filter(
								([, openedPath]) => openedPath !== path,
							),
						),
					},
					document: emptyDoc(
						state.document.lastOpenedPath === path
							? null
							: state.document.lastOpenedPath,
					),
				}));
			}
		} finally {
			window.clearTimeout(timer);
		}
	},
);

export async function loadPath(path: string, options?: LoadPathOptions) {
	if (
		isCodeFile(path) &&
		codeFileOpenModeStore.get() === "default-app" &&
		options?.launchExternal !== false
	) {
		await openPathInDefaultApp(path);
		return;
	}
	if (fileKindForPath(path) !== "external") {
		await loadInternalPath(path, options);
		return;
	}
	try {
		await desktopApi.openPathFromLink(path);
	} catch (err) {
		toast.error("Failed to open file", {
			description: handleFileError(err),
		});
	}
}

/**
 * Opens the app changelog as an ephemeral note. It never touches disk or
 * history: `lastOpenedPath` and the workspace's `lastOpenedPaths` keep the
 * real note so relaunch restores it, and the stack index stays put so back
 * returns to the note the user was on. Returns whether it opened.
 */
export async function openChangelog(): Promise<boolean> {
	const current = viewerStore.get();
	if (isChangelogPath(current.currentPath)) return true;
	if (current.currentPath) {
		await savePathContent(current.currentPath, current.content);
		if (viewerStore.get().externalChange.kind === "conflict") return false;
	}
	// An in-flight loadPath must not resolve over the changelog.
	invalidateLoadPath();
	viewerStore.set((state) => ({
		...state,
		currentPath: CHANGELOG_PATH,
		...cleanFileState(prepareChangelogMarkdown(changelogRaw)),
		viewMode: "rich",
	}));
	return true;
}

async function navigateHistory(delta: -1 | 1) {
	// Keep the toolbar's stack-derived availability stable while preventing a
	// second navigation from racing the in-flight save and load.
	if (historyStore.get().isNavigating) return;
	if (!(delta < 0 ? canGoBack() : canGoForward())) return;

	const current = viewerStore.get();
	if (current.externalChange.kind === "conflict") return;
	// The changelog note is never pushed, so back re-opens the entry the user
	// was on (`entries[index]`, not `index - 1`). Forward never gets here:
	// canGoForward is false on the changelog.
	const fromChangelog = isChangelogPath(current.currentPath);

	// Block concurrent history ops for the whole leave (save + load).
	historyStore.set((state) => ({ ...state, isNavigating: true }));
	try {
		if (current.currentPath) {
			await savePathContent(current.currentPath, current.content);
			if (viewerStore.get().externalChange.kind === "conflict") return;
		}

		let working = activeHistory();
		let nextIndex = working.index + (fromChangelog ? 0 : delta);
		while (nextIndex >= 0 && nextIndex < working.entries.length) {
			const target = working.entries[nextIndex];
			if (await desktopApi.pathExists(target)) {
				setHistory({ entries: working.entries, index: nextIndex });
				await loadPath(target, {
					history: "none",
					missing: "silent",
					launchExternal: false,
				});
				return;
			}
			const entries = working.entries.filter((entry) => entry !== target);
			working = normalizeStack({
				entries,
				index: Math.min(nextIndex - (delta > 0 ? 1 : 0), entries.length - 1),
			});
			setHistory(working);
			// Forward keeps nextIndex (successor shifted in); back steps left.
			nextIndex += delta > 0 ? 0 : -1;
		}
		toast.error(
			delta < 0 ? "No previous file to open" : "No next file to open",
		);
	} finally {
		historyStore.set((state) => ({ ...state, isNavigating: false }));
	}
}

export function goBack() {
	return navigateHistory(-1);
}

export function goForward() {
	return navigateHistory(1);
}

export async function togglePinnedNote(path: string) {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath || !isInWorkspace(path, workspacePath)) return;
	const pinnedNotes = workspaceStore.get().pinnedNotes;
	const nextPinnedNotes = pinnedNotes.includes(path)
		? pinnedNotes.filter((pinnedPath) => pinnedPath !== path)
		: [...pinnedNotes, path];
	workspaceStore.set((state) => ({
		...state,
		pinnedNotes: nextPinnedNotes,
	}));
	try {
		await writePinnedNotes(workspacePath, nextPinnedNotes);
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to update pinned notes", { description: message });
		await loadPinnedNotes(workspacePath);
	}
}

export function setReviewThreads(threads: ReviewThread[]) {
	reviewThreadsStore.set(threads);
}
