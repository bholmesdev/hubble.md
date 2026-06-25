import { toast } from "sonner";
import { desktopApi } from "../desktopApi";
import { classifyFileChange } from "../externalFileChange";
import {
	absoluteWorkspacePath,
	basename,
	dirname,
	extname,
	hasMarkdownExtension,
	joinPath,
	markdownAssetFolderPath,
	normalizePath,
	pathEquals,
	pathInFolder,
	relativeWorkspacePath,
	replacePathPrefix,
} from "../lib/filePath";
import { latest } from "../lib/latest";
import {
	indexMovedFiles,
	type MovedFile,
	movedMarkdownFiles,
	pathAfterMove,
	rewriteMovedLinks,
} from "../lib/markdownLinkRewrite";
import {
	applyFileAction,
	appStore,
	cleanFileState,
	emptyDoc,
	type FileEntry,
	type FolderEntry,
	getBaseline,
	isInWorkspace,
	LOADING_DELAY_MS,
	MAX_RECENT,
	type SortMode,
	sidebarOpenStore,
	switcherOpenStore,
	viewerStore,
	withOpenedDoc,
	workspaceStore,
} from "./state";

const REFRESH_FILES_DEBOUNCE_MS = 250;
const missingPathErrorPattern = /\bENOENT\b|\bENOTDIR\b/;
let refreshFilesTimer: ReturnType<typeof setTimeout> | null = null;

type SidebarMoveItem =
	| { kind: "file"; path: string }
	| { kind: "folder"; folderId: string };

export async function refreshFiles(path = workspaceStore.get().workspacePath) {
	if (!path) return;
	const listing = await desktopApi
		.listDirectory(path)
		.catch((): { files: FileEntry[]; folders: FolderEntry[] } => ({
			files: [],
			folders: [],
		}));

	workspaceStore.set((state) => {
		if (state.workspacePath !== path) return state;
		return { ...state, files: listing.files, folders: listing.folders };
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

function folderPathsFromFiles(files: FileEntry[]) {
	const folders = new Set<string>();
	for (const file of files) {
		let parent = dirname(file.path);
		while (parent) {
			folders.add(parent.toLocaleLowerCase());
			const nextParent = dirname(parent);
			parent = nextParent === parent ? null : nextParent;
		}
	}
	return folders;
}

function uniqueMovePath(parent: string, sourcePath: string, isFolder: boolean) {
	const sourceName = basename(sourcePath);
	const extension = isFolder ? "" : extname(sourceName);
	const stem = extension ? sourceName.slice(0, -extension.length) : sourceName;
	const files = workspaceStore.get().files;
	const existing = new Set([
		...files.map((file) => file.path.toLocaleLowerCase()),
		...folderPathsFromFiles(files),
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

function uniqueMarkdownPath(parent: string): string {
	const files = workspaceStore.get().files;
	const existing = new Set(files.map((file) => file.path.toLocaleLowerCase()));
	for (let index = 1; ; index++) {
		const name = index === 1 ? "new-file.md" : `new-file-${index}.md`;
		const candidate = joinPath(parent, name);
		if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

const pendingRenames = new Map<string, string>();

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

/** Opens a workspace by path. If no path given, shows a folder picker first. */
export async function openWorkspace(path?: string) {
	let nextPath = path;
	if (!nextPath) {
		const selected = await desktopApi.openFolderPicker();
		if (typeof selected !== "string") return;
		nextPath = selected;
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
	await Promise.all([refreshFiles(nextPath), loadPinnedNotes(nextPath)]);

	const lastFile = workspaceStore.get().lastOpenedPaths[nextPath];
	if (lastFile) {
		await loadPath(lastFile);
		return;
	}

	clearViewer();
}

export function updateEditorContent(path: string, content: string) {
	const current = viewerStore.get();
	if (current.currentPath === path && current.content === content) return;

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

export async function savePathContent(
	path: string,
	content: string,
	options?: { force?: boolean },
) {
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
		} catch {
			// Fall through to the write path if the file cannot be read during preflight.
		}
	}

	try {
		await desktopApi.writeFileText(path, content);
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
	const nextNameWithExt = /\.[^/.\\]+$/.test(trimmedName)
		? trimmedName
		: `${trimmedName}${currentExt}`;
	// Slash paths are relative to the current file's folder, matching sidebar
	// rename behavior for nested notes.
	const nextPath = normalizePath(joinPath(parent, nextNameWithExt));
	if (!isSafeRelativeRenamePath(trimmedName, nextPath, workspacePath)) return;
	if (nextPath === path) return;

	try {
		if (isCurrentFile) {
			await savePathContent(path, current.content, { force: true });
		}
		pendingRenames.set(path, nextPath);
		await desktopApi.renameFile(path, nextPath);
		const movedAssetFolder = await moveAssociatedAssetFolder(path, nextPath);
		const movedFiles = [{ fromPath: path, toPath: nextPath }];
		if (movedAssetFolder) movedFiles.push(movedAssetFolder);
		await updateMovedLinks(movedFiles, filesBeforeRename);
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
		await refreshFiles();
		if (isCurrentFile) {
			await loadPath(nextPath);
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
	if (!current.currentPath) return;
	await renameMarkdownFile(current.currentPath, nextName);
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
		if (currentAffected && currentPath) {
			await savePathContent(currentPath, current.content, { force: true });
		}
		await desktopApi.renameFile(sourcePath, nextPath);
		const movedAssetFolder =
			item.kind === "file"
				? await moveAssociatedAssetFolder(sourcePath, nextPath)
				: null;
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
		await refreshFiles();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to move item", { description: message });
		await refreshFiles();
	}
}

export async function renameFolder(sourcePath: string, nextName: string) {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath) return;
	const filesBeforeMove = workspaceStore.get().files;
	const trimmedName = nextName.trim();
	if (!trimmedName) return;

	const sourceParent = dirname(sourcePath);
	if (!sourceParent) return;
	const nextPath = /[\\/]/.test(trimmedName)
		? absoluteWorkspacePath(normalizePath(trimmedName), workspacePath)
		: normalizePath(joinPath(sourceParent, trimmedName));
	if (!isSafeRelativeRenamePath(trimmedName, nextPath, workspacePath)) return;
	if (pathEquals(sourcePath, nextPath)) return;
	if (pathStartsWithFolder(nextPath, sourcePath)) {
		toast.error("Failed to rename folder", {
			description: "A folder cannot be renamed into itself.",
		});
		return;
	}
	if (await desktopApi.pathExists(nextPath)) {
		toast.error("Failed to rename folder", {
			description: "A file or folder already exists at that path.",
		});
		return;
	}

	const current = viewerStore.get();
	const currentPath = current.currentPath;
	const currentAffected =
		currentPath && moveAffectsPath(currentPath, sourcePath, true);
	const movedFiles = movedMarkdownFiles(
		filesBeforeMove,
		sourcePath,
		nextPath,
		true,
	);

	try {
		if (currentAffected && currentPath) {
			await savePathContent(currentPath, current.content, { force: true });
		}
		await desktopApi.renameFile(sourcePath, nextPath);
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.map((file) => ({
					...file,
					path: replacePathPrefix(file.path, sourcePath, nextPath),
				})),
				folders: state.workspace.folders.map((folder) => ({
					...folder,
					path: replacePathPrefix(folder.path, sourcePath, nextPath),
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
		await updateMovedLinks(movedFiles, filesBeforeMove);
		await syncPinnedNotes();
		await refreshFiles();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to rename folder", { description: message });
		await refreshFiles();
	}
}

export async function createMarkdownFileInFolder(parentPath: string) {
	const path = uniqueMarkdownPath(parentPath);
	try {
		await desktopApi.writeFileText(path, "");
		const modified_at = Math.floor(Date.now() / 1000);
		workspaceStore.set((state) => ({
			...state,
			files: [...state.files, { path, modified_at }],
		}));
		await loadPath(path);
		await refreshFiles();
		return path;
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to create file", { description: message });
		return null;
	}
}

export async function deleteMarkdownFile(
	path: string,
	options?: { throwOnError?: boolean },
) {
	try {
		await desktopApi.deleteFile(path);
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
		await refreshFiles();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to delete file", { description: message });
		if (options?.throwOnError) throw err;
	}
}

export async function deleteFolder(path: string) {
	try {
		await desktopApi.deleteFile(path, { recursive: true });
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
		await refreshFiles();
	} catch (err) {
		const message = handleFileError(err);
		toast.error("Failed to delete folder", { description: message });
	}
}

export function handleExternalFileChange(
	path: string,
	nextDiskContent: string,
) {
	viewerStore.set((state) => {
		if (state.currentPath !== path) return state;
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

export const loadPath = latest(async ({ isStale }, path: string) => {
	const timer = window.setTimeout(() => {
		if (isStale()) return;
		viewerStore.set((state) => ({ ...state, status: "loading", error: null }));
	}, LOADING_DELAY_MS);

	try {
		const content = await desktopApi.readFileText(path);
		if (isStale()) return;
		appStore.set((state) => withOpenedDoc(state, path, content));
	} catch (err) {
		if (isStale()) return;
		const message = handleFileError(err);
		toast.error("Failed to open file", { description: message });
		viewerStore.set((state) => ({
			...emptyDoc(state.lastOpenedPath),
			status: "error",
			error: message,
		}));
	} finally {
		window.clearTimeout(timer);
	}
});

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
