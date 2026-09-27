import { isChangelogPath } from "../lib/changelogNote";
import { fileStem, pathEquals } from "../lib/filePath";

/** Tabs hold paths; DocumentState holds the active document's contents. */
export type Tab = { path: string };

export type TabId = string;

export const MAX_CLOSED_TABS = 40;

export type ClosedTab = { path: string; index: number };

export type TabsState = {
	closed: ClosedTab[];
	order: TabId[];
	activeTabId: TabId | null;
	byId: Record<TabId, Tab>;
};

export type TabSession = {
	closed?: ClosedTab[];
	paths: string[];
	activePath: string | null;
};

export function tabSession(tabs: TabsState): TabSession {
	return {
		closed: tabs.closed,
		paths: tabs.order.map((id) => tabs.byId[id].path),
		activePath: tabs.activeTabId
			? (tabs.byId[tabs.activeTabId]?.path ?? null)
			: null,
	};
}

export function tabsFromSession(session?: TabSession): TabsState {
	let tabs = emptyTabs();
	for (const path of session?.paths ?? []) {
		tabs = withOpenedTab(tabs, path, "new");
	}
	return {
		...tabs,
		closed: session?.closed ?? [],
		activeTabId: session?.activePath
			? (findTabByPath(tabs, session.activePath) ?? tabs.order[0] ?? null)
			: (tabs.order[0] ?? null),
	};
}

/** Omit the target to replace the active tab's file. */
export type TabTarget = TabId | "new";

export const emptyTabs = (): TabsState => ({
	closed: [],
	order: [],
	activeTabId: null,
	byId: {},
});

// Keep tab identity stable when a file is renamed or moved.
let lastTabId = 0;

function mintTabId(): TabId {
	lastTabId += 1;
	return `tab-${lastTabId}`;
}

export function findTabByPath(tabs: TabsState, path: string): TabId | null {
	return (
		tabs.order.find((id) => pathEquals(tabs.byId[id]?.path ?? "", path)) ?? null
	);
}

/** Reuse an open path; otherwise replace the target or insert beside the active tab. */
export function withOpenedTab(
	tabs: TabsState,
	path: string,
	target?: TabTarget,
): TabsState {
	const existing = findTabByPath(tabs, path);
	if (existing) {
		return { ...tabs, activeTabId: existing };
	}
	if (target !== "new") {
		const id = target && tabs.byId[target] ? target : tabs.activeTabId;
		if (id && tabs.byId[id]) {
			return {
				...tabs,
				activeTabId: id,
				byId: { ...tabs.byId, [id]: { path } },
			};
		}
	}
	const id = mintTabId();
	const activeAt = tabs.activeTabId ? tabs.order.indexOf(tabs.activeTabId) : -1;
	const order = [...tabs.order];
	order.splice(activeAt < 0 ? order.length : activeAt + 1, 0, id);
	return {
		...tabs,
		order,
		activeTabId: id,
		byId: { ...tabs.byId, [id]: { path } },
	};
}

/** Leave existing tabs alone; insert new paths beside the active tab without focusing. */
export function withBackgroundTab(tabs: TabsState, path: string): TabsState {
	if (findTabByPath(tabs, path)) return tabs;
	return {
		...withOpenedTab(tabs, path, "new"),
		activeTabId: tabs.activeTabId,
	};
}

export function withReorderedTab(
	tabs: TabsState,
	id: TabId,
	toIndex: number,
): TabsState {
	const fromIndex = tabs.order.indexOf(id);
	if (fromIndex < 0 || !Number.isFinite(toIndex)) return tabs;
	const destination = Math.max(
		0,
		Math.min(tabs.order.length - 1, Math.trunc(toIndex)),
	);
	if (fromIndex === destination) return tabs;
	const order = [...tabs.order];
	order.splice(fromIndex, 1);
	order.splice(destination, 0, id);
	return { ...tabs, order };
}

/**
 * The Tab to focus once `id` closes: its right neighbour, falling back to its
 * left. Null when `id` was the only Tab open.
 */
export function nextActiveTabId(tabs: TabsState, id: TabId): TabId | null {
	const at = tabs.order.indexOf(id);
	if (at < 0) return tabs.activeTabId;
	return tabs.order[at + 1] ?? tabs.order[at - 1] ?? null;
}

export function withClosedTab(tabs: TabsState, id: TabId): TabsState {
	if (!tabs.byId[id]) return tabs;
	const { [id]: _closed, ...byId } = tabs.byId;
	return {
		...tabs,
		order: tabs.order.filter((other) => other !== id),
		activeTabId:
			tabs.activeTabId === id ? nextActiveTabId(tabs, id) : tabs.activeTabId,
		byId,
	};
}

/** Callers supply the path match rules for file and folder moves. */
export function withRewrittenTabPaths(
	tabs: TabsState,
	rewrite: (path: string) => string,
): TabsState {
	return {
		...tabs,
		byId: Object.fromEntries(
			Object.entries(tabs.byId).map(([id, tab]) => [
				id,
				{ ...tab, path: rewrite(tab.path) },
			]),
		),
	};
}

export function withoutTabsMatching(
	tabs: TabsState,
	isGone: (path: string) => boolean,
): TabsState {
	return tabs.order
		.filter((id) => isGone(tabs.byId[id]?.path ?? ""))
		.reduce(withClosedTab, tabs);
}

export function tabLabels(tabs: TabsState): Record<TabId, string> {
	return Object.fromEntries(
		tabs.order.map((id) => {
			const path = tabs.byId[id]?.path ?? "";
			return [id, isChangelogPath(path) ? "What's new" : fileStem(path)];
		}),
	);
}
