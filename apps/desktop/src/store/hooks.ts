import { useStoreValue } from "@simplestack/store/react";
import { isChangelogPath } from "../lib/changelogNote";
import { canGoBack, canGoForward } from "./history";
import { activeTabIdStore, currentPathStore, historyStore } from "./state";

// Back/forward enablement depends on two stores: the history stacks and the
// Active Tab that picks the active stack. Boolean selectors re-render callers
// only when enablement actually flips.
export function useHistoryNav() {
	const activeTabId = useStoreValue(activeTabIdStore);
	const onChangelog = useStoreValue(currentPathStore, isChangelogPath);
	return {
		canGoBack: useStoreValue(historyStore, (history) =>
			canGoBack(history, activeTabId, onChangelog),
		),
		canGoForward: useStoreValue(historyStore, (history) =>
			canGoForward(history, activeTabId, onChangelog),
		),
	};
}
