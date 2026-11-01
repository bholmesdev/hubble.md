import { Button, useCommandShortcutLabel } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteLayoutLeftLine from "~icons/mingcute/layout-left-line";
import { desktopApi } from "../desktopApi";
import { useCompactWindow } from "../lib/layout";
import { setSidebarView, toggleSidebar } from "../store/actions";
import { sidebarOpenStore, sidebarViewStore } from "../store/state";
import { tabsStore } from "../store/tabStore";
import { AllTabsMenu } from "./AllTabsMenu";
import { DocumentTabs } from "./DocumentTabs";
import { SidebarViewToggle } from "./InboxView";

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
	singleTab = false,
	children,
}: {
	showSidebarBadge?: boolean;
	/** Hides the tab strip while one tab is open; children take its place. */
	singleTab?: boolean;
	children?: ReactNode;
	onNewTab?: () => void;
	allTabsOpen: boolean;
	onAllTabsOpenChange: (open: boolean) => void;
}) {
	const tabAreaRef = useRef<HTMLDivElement>(null);
	const allTabsButtonRef = useRef<HTMLButtonElement>(null);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const sidebarView = useStoreValue(sidebarViewStore);
	const hasTabs = useStoreValue(tabsStore, (tabs) => tabs.order.length > 0);
	const isFullScreen = useIsFullScreen();
	const compact = useCompactWindow();
	// Spans the sidebar, so the view toggle can right-align with the sidebar header.
	const spansSidebar = sidebarOpen && !compact;
	const toggleSidebarTitle = useCommandShortcutLabel(
		"Toggle sidebar",
		"app.toggle-sidebar",
	);
	const newTabTitle = useCommandShortcutLabel("New tab", "app.new-tab");
	const startInset = isFullScreen ? "0px" : START_INSET;
	const endInset = isFullScreen ? "0px" : END_INSET;
	// A lone tab's row spans the whole bar so its title centers on the window;
	// the sidebar toggle floats over its start unless the sidebar header holds it.
	const overlayToggle = singleTab && !spansSidebar;

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
	}

	return (
		<div
			data-window-title-bar
			data-single-tab={singleTab ? "" : undefined}
			className={`relative flex h-9 min-w-0 shrink-0 select-none items-center overflow-hidden ${singleTab ? "bg-background" : "bg-sidebar after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border"}`}
			style={{
				...dragRegionStyle,
				...(singleTab && {
					"--title-bar-start": overlayToggle
						? `calc(${startInset} + 28px)`
						: "0px",
					"--title-bar-end": endInset,
				}),
			}}
		>
			<div
				className={`flex min-w-0 items-center self-stretch ${overlayToggle ? "absolute inset-y-0 start-0 z-10" : ""} ${spansSidebar ? "gap-2 pe-2.5" : hasTabs && !singleTab ? "pe-4" : ""} ${singleTab && spansSidebar ? "border-e border-sidebar-border bg-sidebar" : ""}`}
				style={{
					flex: spansSidebar
						? "0 0 var(--sidebar-width, 220px)"
						: singleTab
							? "0 0 auto"
							: `0 100 ${hasTabs ? 114 : 98}px`,
					paddingInlineStart: startInset,
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
				{spansSidebar ? (
					<div className="ms-auto flex min-w-0" style={noDragStyle}>
						<SidebarViewToggle view={sidebarView} onChange={setSidebarView} />
					</div>
				) : null}
			</div>
			{singleTab ? (
				<div className="flex min-w-0 flex-1 flex-col self-stretch">
					{children}
				</div>
			) : (
				<>
					{/* Overlap the sidebar seam; the active tab covers the inset divider. */}
					<div
						ref={tabAreaRef}
						className="-ms-px flex min-w-0 flex-1 self-stretch"
					>
						<DocumentTabs
							onNewTab={onNewTab}
							newTabTitle={newTabTitle}
							flushStart={sidebarOpen && !compact}
							showStartDivider={!sidebarOpen}
							onCollapsedChange={handleTabsCollapsedChange}
							collapseTargetRef={allTabsButtonRef}
						/>
					</div>
					<AllTabsMenu
						open={allTabsOpen}
						onOpenChange={onAllTabsOpenChange}
						triggerRef={allTabsButtonRef}
					/>
				</>
			)}
			{singleTab ? null : (
				<div className="shrink-0" style={{ inlineSize: endInset }} />
			)}
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
