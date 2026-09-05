import { TabStrip, type TabStripItem } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { isChangelogPath } from "../lib/changelogNote";
import {
	activateTab,
	closeTab,
	renameCurrentMarkdownFile,
} from "../store/actions";
import { currentPathStore, tabsStore } from "../store/state";
import { tabLabels } from "../store/tabs";

/**
 * Supplies the Tab strip from the store, keeping `packages/ui` free of any
 * store coupling.
 */
export function DocumentTabs({
	onNewTab,
	newTabTitle,
}: {
	onNewTab?: () => void;
	newTabTitle?: string;
}) {
	const tabs = useStoreValue(tabsStore);
	// The changelog takes over the editor without a Tab of its own, so it is
	// the one time the Active Tab is not what the user is reading. Showing it
	// as selected would point at a note that is not on screen.
	const onChangelog = useStoreValue(currentPathStore, isChangelogPath);
	const labels = tabLabels(tabs);
	const items: TabStripItem[] = tabs.order.map((id) => ({
		id,
		label: labels[id] ?? "",
		title: tabs.byId[id]?.path ?? "",
	}));

	return (
		<TabStrip
			tabs={items}
			activeTabId={onChangelog ? null : tabs.activeTabId}
			onActivate={(id) => void activateTab(id)}
			onClose={(id) => void closeTab(id)}
			onNewTab={onNewTab}
			newTabTitle={newTabTitle}
			onRename={
				onChangelog
					? undefined
					: (_id, nextName) => void renameCurrentMarkdownFile(nextName)
			}
		/>
	);
}
