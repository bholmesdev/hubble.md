import { TabStrip, type TabStripItem } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import type { RefObject } from "react";
import { isChangelogPath } from "../lib/changelogNote";
import { fileStem, relativeWorkspacePath } from "../lib/filePath";
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
}: {
	onNewTab?: () => void;
	newTabTitle?: string;
	flushStart: boolean;
	showStartDivider: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	collapseTargetRef: RefObject<HTMLButtonElement | null>;
}) {
	const tabs = useStoreValue(tabsStore);
	const workspacePath = useStoreValue(workspacePathStore);
	const labels = tabLabels(tabs);
	const items: TabStripItem[] = tabs.order.map((id) => {
		const path = tabs.byId[id]?.path ?? "";
		return {
			id,
			label: labels[id] ?? "",
			title: isChangelogPath(path)
				? "What's new"
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
				isChangelogPath(
					tabs.activeTabId ? tabs.byId[tabs.activeTabId]?.path : null,
				)
					? undefined
					: (_id, nextName) => void renameCurrentMarkdownFile(nextName)
			}
		/>
	);
}
