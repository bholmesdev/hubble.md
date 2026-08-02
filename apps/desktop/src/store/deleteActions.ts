import { formatShortcut, type SidebarDeleteItem } from "@hubble.md/ui";
import { toast } from "sonner";
import { desktopApi } from "../desktopApi";
import { pathInFolder } from "../lib/filePath";
import { clearHistory, pruneHistory } from "./history";
import {
	appStore,
	emptyDoc,
	historyStore,
	viewerStore,
	workspaceStore,
} from "./state";

const UNDO_MS = 8000;

type PendingDelete = {
	token: string;
	workspacePath: string;
	reopenPath: string | null;
	removedPins: string[];
	removedLastOpened: Record<string, string>;
	historyBefore: ReturnType<typeof historyStore.get>;
	historyAfter: ReturnType<typeof historyStore.get>;
	pinRemovalSaved: Promise<void>;
	toastId: string | number | null;
	state: "active" | "expiring" | "restoring";
};

type DeleteDeps = {
	saveBeforeDelete: (path: string, content: string) => Promise<void>;
	waitForSaves: (matches: (path: string) => boolean) => Promise<void>;
	refreshFiles: (workspacePath: string) => Promise<void>;
	refreshFileList: () => Promise<void>;
	loadPath: (
		path: string,
		options: { history: "none"; launchExternal: false },
	) => Promise<void>;
	syncPins: () => Promise<void>;
	handleError: (error: unknown) => string;
};

function itemPath(item: SidebarDeleteItem) {
	return item.kind === "file" ? item.path : item.folderId;
}

function covers(path: string, items: SidebarDeleteItem[]) {
	return items.some((item) =>
		item.kind === "file"
			? item.path === path
			: item.folderId === path || pathInFolder(path, item.folderId),
	);
}

export function createDeleteActions(deps: DeleteDeps) {
	let blockedItems: SidebarDeleteItem[] | null = null;
	let pending: PendingDelete | null = null;
	let deleting = false;

	const isSaveBlocked = (path: string) =>
		blockedItems ? covers(path, blockedItems) : false;

	const claim = (state: "expiring" | "restoring", token?: string) => {
		if (
			!pending ||
			pending.state !== "active" ||
			(token && pending.token !== token)
		) {
			return null;
		}
		pending.state = state;
		if (pending.toastId !== null) toast.dismiss(pending.toastId);
		void desktopApi.setDeleteUndoAvailable(false);
		return pending;
	};

	const finish = (finished: PendingDelete) => {
		if (pending !== finished) return;
		pending = null;
		blockedItems = null;
	};

	const expireDeleteUndo = async (token?: string) => {
		const deletion = claim("expiring", token);
		if (!deletion) return false;
		try {
			await deletion.pinRemovalSaved;
			await desktopApi.finalizeDelete(deletion.token);
		} catch (error) {
			toast.error("Failed to finish deleting items", {
				description: deps.handleError(error),
			});
		}
		finish(deletion);
		return true;
	};

	const undoDelete = async (token?: string) => {
		const deletion = claim("restoring", token);
		if (!deletion) return false;
		try {
			// The removal write must finish before restored pins are written back.
			await deletion.pinRemovalSaved;
			await desktopApi.restoreDelete(deletion.token);
		} catch (error) {
			toast.error("Failed to undo deletion", {
				description: deps.handleError(error),
			});
			finish(deletion);
			return false;
		}

		finish(deletion);
		if (workspaceStore.get().workspacePath === deletion.workspacePath) {
			workspaceStore.set((state) => ({
				...state,
				pinnedNotes: [
					...new Set([...state.pinnedNotes, ...deletion.removedPins]),
				],
				lastOpenedPaths: {
					...state.lastOpenedPaths,
					...deletion.removedLastOpened,
				},
			}));
			if (historyStore.get() === deletion.historyAfter) {
				historyStore.set(deletion.historyBefore);
			}
			await deps.refreshFiles(deletion.workspacePath);
			if (deletion.reopenPath && viewerStore.get().currentPath === null) {
				await deps.loadPath(deletion.reopenPath, {
					history: "none",
					launchExternal: false,
				});
			}
			await deps.syncPins();
		}
		return true;
	};

	const runDelete = async (items: SidebarDeleteItem[]) => {
		if (items.length === 0) return;
		await expireDeleteUndo();
		if (pending) return;

		const workspaceBefore = workspaceStore.get();
		if (!workspaceBefore.workspacePath) return;
		const viewerBefore = viewerStore.get();
		const historyBefore = historyStore.get();
		blockedItems = items;
		await deps.waitForSaves((path) => covers(path, items));
		const currentPath = viewerBefore.currentPath;
		if (currentPath && covers(currentPath, items)) {
			try {
				await deps.saveBeforeDelete(currentPath, viewerBefore.content);
			} catch {
				blockedItems = null;
				return;
			}
		}

		let token: string;
		try {
			token = await desktopApi.stageDelete(
				workspaceBefore.workspacePath,
				items.map(itemPath),
			);
		} catch (error) {
			blockedItems = null;
			toast.error("Failed to delete items", {
				description: deps.handleError(error),
			});
			return;
		}
		if (workspaceStore.get().workspacePath !== workspaceBefore.workspacePath) {
			blockedItems = null;
			await desktopApi.finalizeDelete(token);
			return;
		}

		const deletedPath = (path: string) => covers(path, items);
		const deletedCurrent =
			viewerBefore.currentPath !== null &&
			deletedPath(viewerBefore.currentPath);
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
		const pinRemovalSaved = deps.syncPins();
		pending = {
			token,
			workspacePath: workspaceBefore.workspacePath,
			reopenPath: deletedCurrent ? viewerBefore.currentPath : null,
			removedPins,
			removedLastOpened,
			historyBefore,
			historyAfter: historyStore.get(),
			pinRemovalSaved,
			toastId: null,
			state: "active",
		};
		const count = items.length;
		const toastId = toast(
			`Deleted ${count === 1 ? "1 item" : `${count} items`}`,
			{
				duration: UNDO_MS,
				action: {
					label: `Undo ${formatShortcut("CmdOrCtrl+Z")}`,
					onClick: (event) => {
						event.preventDefault();
						void undoDelete(token);
					},
				},
				onAutoClose: () => void expireDeleteUndo(token),
				onDismiss: () => void expireDeleteUndo(token),
			},
		);
		if (pending?.token === token) pending.toastId = toastId;
		await desktopApi.setDeleteUndoAvailable(true);
		await pinRemovalSaved;
	};

	const deleteSidebarItems = async (items: SidebarDeleteItem[]) => {
		if (deleting) return;
		deleting = true;
		try {
			await runDelete(items);
		} finally {
			deleting = false;
		}
	};

	const deleteMarkdownFile = async (
		path: string,
		options?: { throwOnError?: boolean },
	) => {
		try {
			await desktopApi.deleteFile(path);
			if (viewerStore.get().currentPath === path) clearHistory();
			else pruneHistory(path);
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
			await deps.syncPins();
			await deps.refreshFileList();
		} catch (error) {
			toast.error("Failed to delete file", {
				description: deps.handleError(error),
			});
			if (options?.throwOnError) throw error;
		}
	};

	const deleteFolder = async (path: string) => {
		try {
			await desktopApi.deleteFile(path, { recursive: true });
			const currentPath = viewerStore.get().currentPath;
			if (currentPath && pathInFolder(currentPath, path)) clearHistory();
			else pruneHistory(path, true);
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
			await deps.syncPins();
			await deps.refreshFileList();
		} catch (error) {
			toast.error("Failed to delete folder", {
				description: deps.handleError(error),
			});
		}
	};

	return {
		deleteFolder,
		deleteMarkdownFile,
		deleteSidebarItems,
		expireDeleteUndo,
		isSaveBlocked,
		undoDelete,
	};
}
