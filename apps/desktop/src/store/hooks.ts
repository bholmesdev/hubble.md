import { useStoreValue } from "@simplestack/store/react";
import { canGoBack, canGoForward } from "./history";
import { historyStore } from "./state";
import { activeTabIdStore } from "./tabStore";

// Back/forward enablement depends on two stores: the history stacks and the
// Active Tab that picks the active stack. Boolean selectors re-render callers
// only when enablement actually flips.
export function useHistoryNav() {
	const activeTabId = useStoreValue(activeTabIdStore);
	return {
		canGoBack: useStoreValue(historyStore, (history) =>
			canGoBack(history, activeTabId),
		),
		canGoForward: useStoreValue(historyStore, (history) =>
			canGoForward(history, activeTabId),
		),
	};
}
