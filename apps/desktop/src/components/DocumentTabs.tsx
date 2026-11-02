import { TabStrip, type TabStripItem } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { type RefObject, useState } from "react";
import { fileStem, relativeWorkspacePath } from "../lib/filePath";
import { isVirtualPath } from "../lib/newTabPage";
import {
	activateTab,
	closeOtherTabs,
	closeTab,
	closeTabsToLeft,
	renameCurrentMarkdownFile,
	reorderTab,
} from "../store/actions";
import { workspacePathStore } from "../store/state";
import { tabsStore } from "../store/tabStore";
import { tabLabels } from "../store/tabs";

/** Keeps the shared tab strip independent of the desktop store. */
export function DocumentTabs({
	onNewTab,
	newTabTitle,
	flushStart,
	showStartDivider,
	onCollapsedChange,
	collapseTargetRef,
	leaving = false,
}: {
	onNewTab?: () => void;
	newTabTitle?: string;
	flushStart: boolean;
	showStartDivider: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	collapseTargetRef: RefObject<HTMLButtonElement | null>;
	/** The strip is sliding away; keep the tabs it showed, closed one included. */
	leaving?: boolean;
}) {
	const currentTabs = useStoreValue(tabsStore);
	const [shownTabs, setShownTabs] = useState(currentTabs);
	if (!leaving && shownTabs !== currentTabs) setShownTabs(currentTabs);
	const tabs = leaving ? shownTabs : currentTabs;
	const workspacePath = useStoreValue(workspacePathStore);
	const labels = tabLabels(tabs);
	const items: TabStripItem[] = tabs.order.map((id) => {
		const path = tabs.byId[id]?.path ?? "";
		return {
			id,
			label: labels[id] ?? "",
			title: isVirtualPath(path)
				? labels[id]
				: relativeWorkspacePath(path, workspacePath ?? null),
			name: fileStem(path),
		};
	});

	return (
		<TabStrip
			tabs={items}
			flushStart={flushStart}
			showStartDivider={showStartDivider}
			onCollapsedChange={onCollapsedChange}
			collapseTargetRef={collapseTargetRef}
			activeTabId={tabs.activeTabId}
			onActivate={(id) => void activateTab(id)}
			onClose={(id) => void closeTab(id)}
			onCloseOthers={(id) => void closeOtherTabs(id)}
			onCloseLeft={(id) => void closeTabsToLeft(id)}
			onReorder={reorderTab}
			onNewTab={onNewTab}
			newTabTitle={newTabTitle}
			onRename={
				isVirtualPath(
					tabs.activeTabId ? tabs.byId[tabs.activeTabId]?.path : null,
				)
					? undefined
					: (_id, nextName) => void renameCurrentMarkdownFile(nextName)
			}
		/>
	);
}
