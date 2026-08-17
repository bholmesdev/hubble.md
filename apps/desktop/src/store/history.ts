import { isChangelogPath } from "../lib/changelogNote";
import { pathInFolder, replacePathPrefix } from "../lib/filePath";
import {
	activeTabIdStore,
	currentPathStore,
	type HistoryStack,
	type HistoryState,
	historyStore,
	MAX_HISTORY,
	tabsStore,
} from "./state";
import type { TabId } from "./tabs";

/**
 * Per-tab back/forward stacks over opened file paths.
 *
 * This module owns reads and writes of `historyStore`. Navigation itself
 * (save current doc, load target) lives in actions.ts to avoid an import
 * cycle with `loadPath`.
 *
 * Keying by tab rather than by open folder is what lets each tab hold its own
 * trail. It also removes the need for a sentinel key: every open note belongs
 * to a tab, including a Loose File opened with no workspace.
 */

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

function stackFor(history: HistoryState, tabId: TabId | null | undefined) {
	return normalizeStack(tabId ? history.byTab[tabId] : undefined);
}

/** The Active Tab's stack. */
export function activeHistory() {
	return stackFor(historyStore.get(), activeTabIdStore.get());
}

/**
 * Replaces the Active Tab's stack, and drops the stacks of Tabs that have
 * closed.
 *
 * Tabs go away from several places — closing one, deleting its file, clearing
 * the viewer, switching folders — and a stack left behind by any of them can
 * never be reached again. Sweeping them here, on the one write path, means no
 * removal site has to remember, and a missed one cleans up on the next
 * navigation.
 */
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

/** Forgets a closed tab's stack. */
export function dropHistory(tabId: TabId) {
	historyStore.set((state) => {
		if (!(tabId in state.byTab)) return state;
		const { [tabId]: _dropped, ...byTab } = state.byTab;
		return { ...state, byTab };
	});
}

/** Forgets every stack, for when the whole tab set is replaced. */
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

/** Empties the Active Tab's stack. */
export function clearHistory() {
	setHistory({ entries: [], index: -1 });
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

/**
 * Points history at a file's new location after a rename or move so back and
 * forward keep working. With `isFolder`, rewrites the path prefix of every
 * entry inside the folder. Runs across all tabs because a renamed path can
 * appear in any tab's trail, not only the one showing it.
 */
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
	onChangelog = isChangelogPath(currentPathStore.get()),
) {
	const stack = stackFor(history, tabId);
	// The changelog note is never pushed, so back means "return to the current
	// entry" and stays enabled whenever one exists.
	if (onChangelog) return stack.index >= 0;
	return stack.index > 0;
}

export function canGoForward(
	history = historyStore.get(),
	tabId = activeTabIdStore.get(),
	onChangelog = isChangelogPath(currentPathStore.get()),
) {
	if (onChangelog) return false;
	const { index, entries } = stackFor(history, tabId);
	return index >= 0 && index < entries.length - 1;
}
