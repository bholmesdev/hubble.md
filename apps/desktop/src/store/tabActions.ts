import { desktopApi } from "../desktopApi";
import { CHANGELOG_PATH, isChangelogPath } from "../lib/changelogNote";
import { sequential } from "../lib/concurrency";
import { pathEquals } from "../lib/filePath";
import type { loadPath as loadDocument } from "./actions";
import { dropHistory, seedHistory } from "./history";
import { appStore, emptyDoc, viewerStore, workspaceStore } from "./state";
import { tabsStore } from "./tabStore";
import {
	findTabByPath,
	MAX_CLOSED_TABS,
	nextActiveTabId,
	type TabId,
	withBackgroundTab,
	withClosedTab,
	withReorderedTab,
} from "./tabs";

type TabActionDeps = {
	loadPath: typeof loadDocument;
	leaveCurrentDocument: () => Promise<boolean>;
	getWorkspaceRequest: () => number;
};

export function createTabActions({
	loadPath,
	leaveCurrentDocument,
	getWorkspaceRequest,
}: TabActionDeps) {
	/** Tabs are already hydrated; check their files and load the active document asynchronously. */
	async function restoreTabs() {
		const tabs = tabsStore.get();
		const workspacePath = workspaceStore.get().workspacePath;
		const missing = await Promise.all(
			tabs.order.map(async (id) => {
				if (isChangelogPath(tabs.byId[id].path)) return null;
				try {
					return (await desktopApi.pathExists(tabs.byId[id].path)) ? null : id;
				} catch {
					// A temporary permission or disk error must not discard a saved tab.
					return null;
				}
			}),
		);
		if (
			workspaceStore.get().workspacePath !== workspacePath ||
			tabsStore.get() !== tabs
		)
			return;
		const restored = missing.reduce(
			(current, id) => (id ? withClosedTab(current, id) : current),
			tabs,
		);
		appStore.set((state) => ({ ...state, tabs: restored }));
		for (const id of restored.order) seedHistory(id, restored.byId[id].path);
		const active = restored.activeTabId;
		if (active) {
			await loadPath(restored.byId[active].path, {
				history: "none",
				missing: "silent",
				launchExternal: false,
				tab: active,
			});
		}
	}

	/** Open a new tab, or focus the tab already showing this path. */
	async function openTabForPath(path: string) {
		const open = findTabByPath(tabsStore.get(), path);
		if (open) {
			await activateTab(open);
			return;
		}
		await loadPath(path, { tab: "new" });
	}

	/** Open beside the active tab without switching; focus the file if no tab is active. */
	async function openBackgroundTab(path: string) {
		const tabs = tabsStore.get();
		if (findTabByPath(tabs, path)) return;
		if (!tabs.activeTabId) {
			await openTabForPath(path);
			return;
		}
		const next = withBackgroundTab(tabs, path);
		const mintedId = next.order.find((id) => !tabs.byId[id]);
		appStore.set((state) => ({
			...state,
			tabs: next,
		}));
		if (mintedId) seedHistory(mintedId, path);
	}

	/** Read the tab's file without adding history or opening an external app. */
	async function activateTab(id: TabId) {
		const tabs = tabsStore.get();
		const tab = tabs.byId[id];
		if (!tab) return;
		// Reloading the active document would discard its undo history.
		const showing = viewerStore.get().currentPath;
		if (tabs.activeTabId === id && pathEquals(showing ?? "", tab.path)) return;
		await loadPath(tab.path, {
			history: "none",
			launchExternal: false,
			tab: id,
		});
	}

	function reorderTab(id: TabId, toIndex: number) {
		appStore.set((state) => {
			const tabs = withReorderedTab(state.tabs, id, toIndex);
			return tabs === state.tabs ? state : { ...state, tabs };
		});
	}

	/** Close the tab and its history; show a neighbor or clear the editor. */
	async function closeTab(id: TabId) {
		if (!tabsStore.get().byId[id]) return;
		if (tabsStore.get().activeTabId === id && !(await leaveCurrentDocument()))
			return;

		// A file may be deleted while the save runs, so read the tabs again.
		const tabs = tabsStore.get();
		if (!tabs.byId[id]) return;
		const wasActive = tabs.activeTabId === id;
		const next = wasActive ? nextActiveTabId(tabs, id) : null;

		dropHistory(id);
		appStore.set((state) => ({
			...state,
			tabs: {
				...withClosedTab(state.tabs, id),
				closed: [
					...state.tabs.closed,
					{ path: tabs.byId[id].path, index: tabs.order.indexOf(id) },
				].slice(-MAX_CLOSED_TABS),
			},
		}));

		if (!wasActive) return;
		const nextPath = next ? tabsStore.get().byId[next]?.path : null;
		if (nextPath && next) {
			await loadPath(nextPath, {
				history: "none",
				launchExternal: false,
				tab: next,
			});
			return;
		}
		appStore.set((state) => ({
			...state,
			document: emptyDoc(),
		}));
	}

	const reopenClosedTabInOrder = sequential(async (request: number) => {
		while (request === getWorkspaceRequest()) {
			const stack = tabsStore.get().closed;
			const closed = stack[stack.length - 1];
			if (!closed) return;
			if (!isChangelogPath(closed.path)) {
				let exists: boolean;
				try {
					exists = await desktopApi.pathExists(closed.path);
				} catch {
					return;
				}
				if (request !== getWorkspaceRequest()) return;
				if (!exists) {
					tabsStore.set((tabs) => ({
						...tabs,
						closed: tabs.closed.filter((entry) => entry !== closed),
					}));
					continue;
				}
			}
			const existing = findTabByPath(tabsStore.get(), closed.path);
			if (existing) await activateTab(existing);
			else await loadPath(closed.path, { tab: "new", launchExternal: false });
			if (request !== getWorkspaceRequest()) return;
			const tabs = tabsStore.get();
			const active = tabs.activeTabId;
			if (
				!active ||
				!pathEquals(tabs.byId[active].path, closed.path) ||
				!pathEquals(viewerStore.get().currentPath ?? "", closed.path) ||
				viewerStore.get().status !== "ready"
			)
				return;
			tabsStore.set((current) => ({
				...withReorderedTab(current, active, closed.index),
				closed: current.closed.filter((entry) => entry !== closed),
			}));
			return;
		}
	});

	/** Keep failed opens on the stack; only a shown document consumes its entry. */
	function reopenClosedTab() {
		return reopenClosedTabInOrder(getWorkspaceRequest());
	}

	async function closeOtherTabs(keepId?: TabId) {
		let tabs = tabsStore.get();
		const keep = keepId ?? tabs.activeTabId;
		if (!keep || !tabs.order.includes(keep)) return;
		if (tabs.activeTabId !== keep) {
			await activateTab(keep);
			if (tabsStore.get().activeTabId !== keep) return;
			tabs = tabsStore.get();
		}
		for (const id of tabs.order) {
			if (id !== keep) await closeTab(id);
		}
	}

	async function closeTabsToLeft(id: TabId) {
		const tabs = tabsStore.get();
		const index = tabs.order.indexOf(id);
		if (index <= 0) return;
		const closing = tabs.order.slice(0, index);
		if (tabs.activeTabId && closing.includes(tabs.activeTabId)) {
			await activateTab(id);
			if (tabsStore.get().activeTabId !== id) return;
		}
		for (const closingId of closing) await closeTab(closingId);
	}

	/** Close every tab and clear the editor. */
	async function closeAllTabs() {
		// Background tabs go first, or closing the front one would load a
		// neighbour that is about to close anyway.
		await closeOtherTabs();
		await closeActiveTab();
	}

	async function closeActiveTab() {
		const active = tabsStore.get().activeTabId;
		if (active) await closeTab(active);
	}

	/** Move by `delta` in tab order, wrapping at either end. */
	async function activateAdjacentTab(delta: number) {
		const { order, activeTabId } = tabsStore.get();
		if (order.length < 2 || !activeTabId) return;
		const at = order.indexOf(activeTabId);
		if (at < 0) return;
		const next = order[(at + delta + order.length) % order.length];
		await activateTab(next);
	}

	/** Open the changelog in its own tab, reusing it when already open. */
	async function openChangelog(): Promise<boolean> {
		if (isChangelogPath(viewerStore.get().currentPath)) return true;
		await openTabForPath(CHANGELOG_PATH);
		return isChangelogPath(viewerStore.get().currentPath);
	}

	return {
		restoreTabs,
		openTabForPath,
		openBackgroundTab,
		activateTab,
		reorderTab,
		closeTab,
		reopenClosedTab,
		closeOtherTabs,
		closeTabsToLeft,
		closeAllTabs,
		closeActiveTab,
		activateAdjacentTab,
		openChangelog,
	};
}
