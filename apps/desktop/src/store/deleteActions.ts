import type { SidebarDeleteItem } from "@hubble.md/ui";
import { toast } from "sonner";
import { undoToastLabel } from "../components/undoToastLabel";
import { desktopApi } from "../desktopApi";
import { pathInFolder } from "../lib/filePath";
import { newTabPath } from "../lib/newTabPage";
import { clearHistory, pruneHistory } from "./history";
import {
	appStore,
	emptyDoc,
	historyStore,
	viewerStore,
	workspaceStore,
} from "./state";
import { tabsStore } from "./tabStore";

import { findTabByPath, type TabId, withoutTabsMatching } from "./tabs";

const UNDO_MS = 5000;

type PendingDelete = {
	token: string;
	workspacePath: string;
	reopenPath: string | null;
	removedPins: string[];
	keptTab?: { id: string; path: string };
	historyBefore: ReturnType<typeof historyStore.get>;
	historyAfter: ReturnType<typeof historyStore.get>;
	// Keep tab positions so undo can restore the original order.
	tabsBefore: ReturnType<typeof tabsStore.get>;
	tabsAfter: ReturnType<typeof tabsStore.get>;
	pinRemovalSaved: Promise<void>;
	toastId: string | number | null;
	claimed: boolean;
};

type DeleteDeps = {
	saveBeforeDelete: (path: string, content: string) => Promise<void>;
	waitForSaves: (matches: (path: string) => boolean) => Promise<void>;
	refreshFiles: (workspacePath: string) => Promise<void>;
	refreshFileList: () => Promise<void>;
	loadPath: (
		path: string,
		options: { history: "none"; launchExternal: false; tab?: TabId },
	) => Promise<void>;
	syncPins: () => Promise<void>;
	stopTitleRenames: (path: string) => void;
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

	// The toast timeout, Cmd+Z, and the next delete all race to settle the
	// pending deletion; exactly one caller may claim it. Passing a token
	// limits the claim to that deletion, so a stale toast callback is a no-op.
	const claim = (token?: string) => {
		if (!pending || pending.claimed || (token && pending.token !== token)) {
			return null;
		}
		pending.claimed = true;
		if (pending.toastId !== null) toast.dismiss(pending.toastId);
		void desktopApi.setDeleteUndoAvailable(false);
		return pending;
	};

	// Saves to the deleted paths stay blocked while the claimed expire or
	// restore is in flight, so cleanup happens here rather than in claim.
	const finish = (finished: PendingDelete) => {
		if (pending !== finished) return;
		pending = null;
		blockedItems = null;
	};

	const expireDeleteUndo = async (token?: string) => {
		const deletion = claim(token);
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
		const deletion = claim(token);
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
			}));
			if (historyStore.get() === deletion.historyAfter) {
				historyStore.set(deletion.historyBefore);
			}
			// Do not overwrite tab changes made since the deletion.
			if (tabsStore.get() === deletion.tabsAfter) {
				appStore.set((state) => ({ ...state, tabs: deletion.tabsBefore }));
			}
			const kept = deletion.keptTab;
			if (
				kept &&
				deletion.reopenPath &&
				tabsStore.get().byId[kept.id]?.path === kept.path
			) {
				const path = deletion.reopenPath;
				tabsStore.set((tabs) => ({
					...tabs,
					byId: { ...tabs.byId, [kept.id]: { ...tabs.byId[kept.id], path } },
				}));
			}
			await deps.refreshFiles(deletion.workspacePath);
			const restoredTab = deletion.reopenPath
				? findTabByPath(tabsStore.get(), deletion.reopenPath)
				: null;
			// Only reopen if the user has not moved to another note.
			if (
				deletion.reopenPath &&
				(viewerStore.get().currentPath === null ||
					(restoredTab !== null && tabsStore.get().activeTabId === restoredTab))
			) {
				await deps.loadPath(deletion.reopenPath, {
					history: "none",
					launchExternal: false,
					tab: restoredTab ?? undefined,
				});
			}
			await deps.syncPins();
		}
		return true;
	};

	/**
	 * Blocks saves to the items, flushes the open note, and stages the items
	 * for undoable deletion. Returns the deletion token, or null if the
	 * delete was abandoned; abandoning unblocks saves.
	 */
	const stageItems = async (
		items: SidebarDeleteItem[],
		workspacePath: string,
		viewer: { currentPath: string | null; content: string },
		beforeStage?: (phase: "before-save" | "before-stage") => Promise<void>,
	): Promise<string | null> => {
		const abandon = () => {
			blockedItems = null;
			return null;
		};
		// Block new saves to the deleted paths before waiting out in-flight
		// ones, so a queued autosave cannot recreate a staged file.
		blockedItems = items;
		await deps.waitForSaves((path) => covers(path, items));
		// Check disk before flushing too: a forced save must not overwrite a newer external edit.
		try {
			await beforeStage?.("before-save");
		} catch (error) {
			blockedItems = null;
			throw error;
		}
		if (viewer.currentPath && covers(viewer.currentPath, items)) {
			try {
				// Flush the open note so the staged copy holds its latest text.
				await deps.saveBeforeDelete(viewer.currentPath, viewer.content);
			} catch {
				return abandon(); // The save already raised its own toast.
			}
		}
		// Agent deletions recheck scope and the read version after queued saves settle.
		try {
			await beforeStage?.("before-stage");
		} catch (error) {
			blockedItems = null;
			throw error;
		}
		let token: string;
		try {
			token = await desktopApi.stageDelete(workspacePath, items.map(itemPath));
		} catch (error) {
			toast.error("Failed to delete items", {
				description: deps.handleError(error),
			});
			return abandon();
		}
		if (workspaceStore.get().workspacePath !== workspacePath) {
			// The user switched workspaces while staging; undo would restore
			// into the wrong sidebar, so drop the staged files right away.
			abandon();
			await desktopApi.finalizeDelete(token);
			return null;
		}
		return token;
	};

	const runDelete = async (
		items: SidebarDeleteItem[],
		beforeStage?: (phase: "before-save" | "before-stage") => Promise<void>,
		preserveTabId?: string,
	) => {
		if (items.length === 0) return false;
		await expireDeleteUndo();
		if (pending) return false;

		const workspaceBefore = workspaceStore.get();
		if (!workspaceBefore.workspacePath) return false;
		const viewerBefore = viewerStore.get();
		const historyBefore = historyStore.get();
		const token = await stageItems(
			items,
			workspaceBefore.workspacePath,
			viewerBefore,
			beforeStage,
		);
		if (token === null) return false;

		const deletedPath = (path: string) => covers(path, items);
		const deletedCurrent =
			viewerBefore.currentPath !== null &&
			deletedPath(viewerBefore.currentPath);
		const removedPins = workspaceBefore.pinnedNotes.filter(deletedPath);
		// Deleted files may also appear in background tabs' history.
		for (const item of items) {
			if (item.kind === "file") pruneHistory(item.path);
			else pruneHistory(item.folderId, true);
		}
		if (deletedCurrent) {
			if (viewerBefore.currentPath)
				deps.stopTitleRenames(viewerBefore.currentPath);
			clearHistory();
		}
		const tabsBefore = tabsStore.get();
		appStore.set((state) => {
			let tabs = withoutTabsMatching(state.tabs, deletedPath);
			const kept = preserveTabId ? state.tabs.byId[preserveTabId] : undefined;
			if (preserveTabId && kept && deletedPath(kept.path)) {
				// A tool must not erase the conversation that requested the deletion.
				tabs = {
					...tabs,
					activeTabId:
						state.tabs.activeTabId === preserveTabId
							? preserveTabId
							: tabs.activeTabId,
					order: state.tabs.order.filter(
						(id) => id === preserveTabId || !!tabs.byId[id],
					),
					byId: {
						...tabs.byId,
						[preserveTabId]: { ...kept, path: newTabPath() },
					},
				};
			}
			const keptActive = !!preserveTabId && tabs.activeTabId === preserveTabId;
			return {
				...state,
				workspace: {
					...state.workspace,
					files: state.workspace.files.filter(
						(file) => !deletedPath(file.path),
					),
					folders: state.workspace.folders.filter(
						(folder) => !deletedPath(folder.path),
					),
					pinnedNotes: state.workspace.pinnedNotes.filter(
						(pin) => !deletedPath(pin),
					),
				},
				tabs,
				document: deletedCurrent
					? {
							...emptyDoc(),
							...(keptActive
								? {
										currentPath: tabs.byId[preserveTabId].path,
										status: "ready" as const,
									}
								: {}),
						}
					: state.document,
			};
		});

		// Load the surviving active tab after deleting the visible note.
		if (deletedCurrent && tabsStore.get().activeTabId !== preserveTabId) {
			const survivor = tabsStore.get().activeTabId;
			const survivorPath = survivor
				? tabsStore.get().byId[survivor]?.path
				: null;
			if (survivor && survivorPath) {
				await deps.loadPath(survivorPath, {
					history: "none",
					launchExternal: false,
					tab: survivor,
				});
			}
		}
		const pinRemovalSaved = deps.syncPins();
		const deletion: PendingDelete = {
			token,
			workspacePath: workspaceBefore.workspacePath,
			reopenPath: deletedCurrent ? viewerBefore.currentPath : null,
			removedPins,
			keptTab:
				preserveTabId && tabsStore.get().byId[preserveTabId]
					? {
							id: preserveTabId,
							path: tabsStore.get().byId[preserveTabId].path,
						}
					: undefined,
			historyBefore,
			historyAfter: historyStore.get(),
			tabsBefore,
			tabsAfter: tabsStore.get(),
			pinRemovalSaved,
			toastId: null,
			claimed: false,
		};
		pending = deletion;
		const count = items.length;
		deletion.toastId = toast(
			`Deleted ${count === 1 ? "1 item" : `${count} items`}`,
			{
				duration: UNDO_MS,
				action: {
					label: undoToastLabel(),
					onClick: (event) => {
						event.preventDefault();
						void undoDelete(token);
					},
				},
				onAutoClose: () => void expireDeleteUndo(token),
				onDismiss: () => void expireDeleteUndo(token),
			},
		);
		await desktopApi.setDeleteUndoAvailable(true);
		await pinRemovalSaved;
		return true;
	};

	const deleteSidebarItems = async (
		items: SidebarDeleteItem[],
		options?: {
			beforeStage?: (phase: "before-save" | "before-stage") => Promise<void>;
			preserveTabId?: string;
		},
	) => {
		if (deleting) return false;
		deleting = true;
		try {
			return await runDelete(
				items,
				options?.beforeStage,
				options?.preserveTabId,
			);
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
			if (viewerStore.get().currentPath === path) {
				deps.stopTitleRenames(path);
				clearHistory();
			} else pruneHistory(path);
			appStore.set((state) => ({
				...state,
				workspace: {
					...state.workspace,
					files: state.workspace.files.filter((file) => file.path !== path),
					pinnedNotes: state.workspace.pinnedNotes.filter(
						(pinnedPath) => pinnedPath !== path,
					),
				},
				tabs: withoutTabsMatching(state.tabs, (tabPath) => tabPath === path),
				document:
					state.document.currentPath === path ? emptyDoc() : state.document,
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
				},
				tabs: withoutTabsMatching(state.tabs, (tabPath) =>
					pathInFolder(tabPath, path),
				),
				document:
					state.document.currentPath &&
					pathInFolder(state.document.currentPath, path)
						? emptyDoc()
						: state.document,
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
