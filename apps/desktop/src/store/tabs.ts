import { basename, dirname, fileStem, pathEquals } from "../lib/filePath";

/**
 * An open note in the tab strip. A Tab records where a note is, not what it
 * holds: the open document itself stays in `DocumentState`, and activating a
 * Tab re-reads it from disk the same way opening a note from the sidebar does.
 */
export type Tab = { path: string };

export type TabId = string;

export type TabsState = {
	order: TabId[];
	activeTabId: TabId | null;
	byId: Record<TabId, Tab>;
};

/**
 * Which Tab a load lands in. Omitted means the Active Tab, so navigation that
 * predates tabs keeps replacing what is on screen rather than piling up Tabs
 * behind the user.
 */
export type TabTarget = TabId | "new";

export const emptyTabs = (): TabsState => ({
	order: [],
	activeTabId: null,
	byId: {},
});

// Ids are opaque because a note's path is not its identity: auto-titling
// renames a new note moments after it is created, and rename and move rewrite
// paths under an open Tab.
let lastTabId = 0;

function mintTabId(): TabId {
	lastTabId += 1;
	return `tab-${lastTabId}`;
}

/** The Tab showing `path`, or null when no open Tab does. */
export function findTabByPath(tabs: TabsState, path: string): TabId | null {
	return (
		tabs.order.find((id) => pathEquals(tabs.byId[id]?.path ?? "", path)) ?? null
	);
}

/**
 * Opens `path` in `target`, minting a Tab when there is none to reuse. The new
 * Tab lands directly right of the Active one, so opening from a Tab keeps its
 * result next to where it was asked for.
 */
export function withOpenedTab(
	tabs: TabsState,
	path: string,
	target?: TabTarget,
): TabsState {
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
	return { order, activeTabId: id, byId: { ...tabs.byId, [id]: { path } } };
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
		order: tabs.order.filter((other) => other !== id),
		activeTabId:
			tabs.activeTabId === id ? nextActiveTabId(tabs, id) : tabs.activeTabId,
		byId,
	};
}

/**
 * Moves every Tab's path through `rewrite`. Rename, folder rename, and move
 * each decide what counts as a match differently, so the caller supplies the
 * rewrite it already uses elsewhere and this only walks the Tabs.
 */
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

/** Closes every Tab whose path `isGone` accepts. */
export function withoutTabsMatching(
	tabs: TabsState,
	isGone: (path: string) => boolean,
): TabsState {
	return tabs.order
		.filter((id) => isGone(tabs.byId[id]?.path ?? ""))
		.reduce(withClosedTab, tabs);
}

/**
 * Tab labels: the note's name, qualified with its folder when another open Tab
 * shares that name. Two notes called `index` in different folders are the case
 * that makes an unqualified strip unreadable.
 */
export function tabLabels(tabs: TabsState): Record<TabId, string> {
	const stems = tabs.order.map((id) => fileStem(tabs.byId[id]?.path ?? ""));
	return Object.fromEntries(
		tabs.order.map((id, at) => {
			const stem = stems[at];
			const shared = stems.some(
				(other, index) => index !== at && other === stem,
			);
			const folder = dirname(tabs.byId[id]?.path ?? "");
			return [id, shared && folder ? `${basename(folder)}/${stem}` : stem];
		}),
	);
}
