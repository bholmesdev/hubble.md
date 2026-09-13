import { Button, useCommandShortcutLabel } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import MingcuteLayoutLeftLine from "~icons/mingcute/layout-left-line";
import { desktopApi } from "../desktopApi";
import { useCompactWindow } from "../lib/layout";
import { toggleSidebar } from "../store/actions";
import { sidebarOpenStore, tabsStore } from "../store/state";
import { AllTabsMenu } from "./AllTabsMenu";
import { DocumentTabs } from "./DocumentTabs";

const START_INSET =
	desktopApi.platform === "darwin"
		? "var(--hubble-traffic-light-inset, 70px)"
		: "8px";
const END_INSET =
	desktopApi.platform === "darwin"
		? "0px"
		: "calc(100vw - env(titlebar-area-width, calc(100vw - 138px)))";
const noDragStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

const dragRegionStyle = {
	WebkitAppRegion: "drag",
} as CSSProperties;

export function WindowTitleBar({
	showSidebarBadge = false,
	onNewTab,
	allTabsOpen,
	onAllTabsOpenChange,
}: {
	showSidebarBadge?: boolean;
	onNewTab?: () => void;
	allTabsOpen: boolean;
	onAllTabsOpenChange: (open: boolean) => void;
}) {
	const [tabsCollapsed, setTabsCollapsed] = useState(false);
	const tabAreaRef = useRef<HTMLDivElement>(null);
	const allTabsButtonRef = useRef<HTMLButtonElement>(null);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const hasTabs = useStoreValue(tabsStore, (tabs) => tabs.order.length > 0);
	const isFullScreen = useIsFullScreen();
	const compact = useCompactWindow();
	const toggleSidebarTitle = useCommandShortcutLabel(
		"Toggle sidebar",
		"app.toggle-sidebar",
	);
	const newTabTitle = useCommandShortcutLabel("New tab", "app.new-tab");

	function handleTabsCollapsedChange(collapsed: boolean) {
		if (
			collapsed &&
			document.activeElement?.matches(":focus-visible") &&
			tabAreaRef.current
				?.querySelector('[role="tablist"]')
				?.contains(document.activeElement)
		) {
			allTabsButtonRef.current?.focus();
		}
		setTabsCollapsed(collapsed);
	}

	return (
		<div
			data-window-title-bar
			className="relative flex h-9 min-w-0 shrink-0 select-none items-center overflow-hidden bg-linear-to-b from-sidebar to-background after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border"
			style={dragRegionStyle}
		>
			<div
				className={`flex items-center ${hasTabs ? "pe-4" : ""}`}
				style={{
					flex:
						sidebarOpen && !compact
							? "0 0 var(--sidebar-width, 220px)"
							: `0 100 ${hasTabs ? 114 : 98}px`,
					paddingInlineStart: isFullScreen ? 0 : START_INSET,
				}}
			>
				<Button
					data-sidebar-toggle
					variant="ghost"
					size="icon-sm"
					className="relative"
					style={noDragStyle}
					onClick={toggleSidebar}
					aria-label="Toggle sidebar"
					title={toggleSidebarTitle}
				>
					<MingcuteLayoutLeftLine className="size-4" />
					{showSidebarBadge ? (
						<span className="absolute top-1 end-1 size-1.5 rounded-full bg-primary" />
					) : null}
				</Button>
			</div>
			{/* Overlap the sidebar seam; the active tab covers the inset divider. */}
			<div ref={tabAreaRef} className="-ms-px flex min-w-0 flex-1 self-stretch">
				<DocumentTabs
					onNewTab={onNewTab}
					newTabTitle={newTabTitle}
					flushStart={sidebarOpen && !compact}
					onCollapsedChange={handleTabsCollapsedChange}
				/>
			</div>
			<AllTabsMenu
				open={allTabsOpen}
				onOpenChange={onAllTabsOpenChange}
				tabsCollapsed={tabsCollapsed}
				triggerRef={allTabsButtonRef}
			/>
			<div
				className="shrink-0"
				style={{ inlineSize: isFullScreen ? 0 : END_INSET }}
			/>
		</div>
	);
}

// Traffic lights are hidden in fullscreen, so drop their reserved inset.
function useIsFullScreen() {
	const [isFullScreen, setIsFullScreen] = useState(false);
	useEffect(() => {
		void desktopApi.getFullScreen().then(setIsFullScreen);
		return desktopApi.onFullScreenChange(setIsFullScreen);
	}, []);
	return isFullScreen;
}
