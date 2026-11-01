import { pathInFolder, replacePathPrefix } from "../lib/filePath";
import {
	type HistoryStack,
	type HistoryState,
	historyStore,
	MAX_HISTORY,
} from "./state";
import { activeTabIdStore, tabsStore } from "./tabStore";
import type { TabId } from "./tabs";

// This module owns per-tab history; actions.ts saves and loads documents to avoid an import cycle.

/** Clamps a persisted or edited stack so `index` always points at an entry. */
export function normalizeStack(stack?: HistoryStack): HistoryStack {
	if (!stack || stack.entries.length === 0) {
		return { entries: [], index: -1 };
	}
	return {
		entries: stack.entries,
		index: Math.min(Math.max(stack.index, 0), stack.entries.length - 1),
	};
}

export function activeHistory() {
	return stackFor(historyStore.get(), activeTabIdStore.get());
}

/** Drop closed tabs' stacks on each write so every removal path gets cleaned up. */
export function setHistory(stack: HistoryStack) {
	const tabId = activeTabIdStore.get();
	if (!tabId) return;
	const open = new Set(tabsStore.get().order);
	historyStore.set((state) => ({
		...state,
		byTab: {
			...Object.fromEntries(
				Object.entries(state.byTab).filter(([id]) => open.has(id)),
			),
			[tabId]: stack,
		},
	}));
}

/** Save a new tab's starting path so Back can return to it. */
export function seedHistory(tabId: TabId, path: string) {
	historyStore.set((state) => {
		if (state.byTab[tabId]?.entries.length) return state;
		return {
			...state,
			byTab: {
				...state.byTab,
				[tabId]: { entries: [path], index: 0 },
			},
		};
	});
}

export function dropHistory(tabId: TabId) {
	historyStore.set((state) => {
		if (!(tabId in state.byTab)) return state;
		const { [tabId]: _dropped, ...byTab } = state.byTab;
		return { ...state, byTab };
	});
}

export function resetHistory() {
	historyStore.set((state) => ({ ...state, byTab: {} }));
}

/**
 * Records a visit: drops any forward entries, appends `path`, and trims to
 * `MAX_HISTORY`. No-op when `path` is already the current entry.
 */
export function pushHistory(path: string) {
	const stack = activeHistory();
	if (stack.entries[stack.index] === path) return;
	const entries = [...stack.entries.slice(0, stack.index + 1), path].slice(
		-MAX_HISTORY,
	);
	setHistory({ entries, index: entries.length - 1 });
}

export function clearHistory() {
	setHistory({ entries: [], index: -1 });
}

/** A renamed path can appear in any tab's history, so update every stack. */
export function rewriteHistory(
	fromPath: string,
	toPath: string,
	isFolder = false,
) {
	mapHistory((stack) => ({
		...stack,
		entries: stack.entries.map((entry) =>
			isFolder
				? replacePathPrefix(entry, fromPath, toPath)
				: entry === fromPath
					? toPath
					: entry,
		),
	}));
}

/**
 * Drops a deleted file (or with `isFolder`, a folder's contents) from every
 * stack. Keeps the index on the current entry when it survives; otherwise
 * clamps toward the nearest remaining entry.
 */
export function pruneHistory(path: string, isFolder = false) {
	mapHistory((stack) => {
		const current = stack.entries[stack.index];
		const entries = stack.entries.filter((entry) =>
			isFolder ? !pathInFolder(entry, path) : entry !== path,
		);
		const keptIndex = current ? entries.indexOf(current) : -1;
		return {
			entries,
			index:
				keptIndex >= 0 ? keptIndex : Math.min(stack.index, entries.length - 1),
		};
	});
}

export function canGoBack(
	history = historyStore.get(),
	tabId = activeTabIdStore.get(),
) {
	const stack = stackFor(history, tabId);
	return stack.index > 0;
}

export function canGoForward(
	history = historyStore.get(),
	tabId = activeTabIdStore.get(),
) {
	const { index, entries } = stackFor(history, tabId);
	return index >= 0 && index < entries.length - 1;
}

function stackFor(history: HistoryState, tabId: TabId | null | undefined) {
	return normalizeStack(tabId ? history.byTab[tabId] : undefined);
}

/** Applies `update` to every tab's stack, normalizing around it. */
function mapHistory(update: (stack: HistoryStack) => HistoryStack) {
	historyStore.set((state) => ({
		...state,
		byTab: Object.fromEntries(
			Object.entries(state.byTab).map(([key, stack]) => [
				key,
				normalizeStack(update(normalizeStack(stack))),
			]),
		),
	}));
}
