// @vitest-environment happy-dom

import { act, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowTitleBar } from "./WindowTitleBar";

const state = vi.hoisted(() => ({
	sidebarOpen: false,
	compact: false,
	fullScreen: false,
	onCollapsedChange: undefined as ((value: boolean) => void) | undefined,
	onFullScreenChange: undefined as ((value: boolean) => void) | undefined,
	toggleSidebar: vi.fn(),
	unsubscribe: vi.fn(),
}));

vi.mock("../desktopApi", () => ({
	desktopApi: {
		platform: "darwin",
		getFullScreen: async () => state.fullScreen,
		onFullScreenChange: (callback: (value: boolean) => void) => {
			state.onFullScreenChange = callback;
			return state.unsubscribe;
		},
	},
}));
vi.mock("@simplestack/store/react", () => ({
	useStoreValue: (store: string) =>
		store === "sidebar" ? state.sidebarOpen : true,
}));
vi.mock("../store/state", () => ({
	sidebarOpenStore: "sidebar",
	tabsStore: "tabs",
}));
vi.mock("../store/actions", () => ({ toggleSidebar: state.toggleSidebar }));
vi.mock("../lib/layout", () => ({ useCompactWindow: () => state.compact }));
vi.mock("./AllTabsMenu", () => ({
	AllTabsMenu: ({
		triggerRef,
		tabsCollapsed,
	}: {
		triggerRef: Ref<HTMLButtonElement>;
		tabsCollapsed: boolean;
	}) => (
		<button
			type="button"
			ref={triggerRef}
			data-all-tabs
			data-collapsed={String(tabsCollapsed)}
		>
			All tabs
		</button>
	),
}));
vi.mock("./DocumentTabs", () => ({
	DocumentTabs: ({
		flushStart,
		onCollapsedChange,
	}: {
		flushStart: boolean;
		onCollapsedChange: (value: boolean) => void;
	}) => {
		state.onCollapsedChange = onCollapsedChange;
		return (
			<div role="tablist" data-tabs-flush-start={String(flushStart)}>
				<button type="button" role="tab" aria-selected="true">
					Note
				</button>
			</div>
		);
	},
}));

describe("WindowTitleBar", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		state.sidebarOpen = false;
		state.compact = false;
		state.fullScreen = false;
		state.onFullScreenChange = undefined;
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	async function render() {
		await act(async () =>
			root.render(
				<WindowTitleBar allTabsOpen={false} onAllTabsOpenChange={() => {}} />,
			),
		);
	}

	it("keeps blank titlebar space draggable and the sidebar toggle clickable", async () => {
		await render();
		const bar = container.querySelector<HTMLElement>("[data-window-title-bar]");
		const toggle = container.querySelector<HTMLButtonElement>(
			"[data-sidebar-toggle]",
		);
		expect(appRegion(bar)).toBe("drag");
		expect(appRegion(toggle)).toBe("no-drag");
		expect(appRegion(toggle?.parentElement)).not.toBe("no-drag");
		await act(async () => toggle?.click());
		expect(state.toggleSidebar).toHaveBeenCalledOnce();
	});

	it.each([
		{ sidebarOpen: true, compact: false, flush: "true" },
		{ sidebarOpen: false, compact: false, flush: "false" },
		{ sidebarOpen: true, compact: true, flush: "false" },
	])("uses the sidebar seam only when docked: $sidebarOpen / $compact", async ({
		sidebarOpen,
		compact,
		flush,
	}) => {
		state.sidebarOpen = sidebarOpen;
		state.compact = compact;
		await render();
		expect(
			container
				.querySelector("[data-tabs-flush-start]")
				?.getAttribute("data-tabs-flush-start"),
		).toBe(flush);
	});

	it("moves keyboard focus to the dropdown when tabs collapse", async () => {
		await render();
		const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
		const dropdown =
			container.querySelector<HTMLButtonElement>("[data-all-tabs]");
		tab?.focus();
		if (tab) vi.spyOn(tab, "matches").mockReturnValue(true);
		await act(async () => state.onCollapsedChange?.(true));
		expect(document.activeElement).toBe(dropdown);
		expect(dropdown?.getAttribute("data-collapsed")).toBe("true");
		await act(async () => state.onCollapsedChange?.(false));
		expect(dropdown?.getAttribute("data-collapsed")).toBe("false");
		expect(document.activeElement).toBe(dropdown);
	});

	it("releases traffic-light space in fullscreen and restores it on exit", async () => {
		await render();
		const controls = container.querySelector<HTMLElement>(
			"[data-sidebar-toggle]",
		)?.parentElement;
		const inset = controls?.style.paddingInlineStart;
		expect(inset).toContain("--hubble-traffic-light-inset");
		await act(async () => state.onFullScreenChange?.(true));
		expect(controls?.style.paddingInlineStart).toMatch(/^0(px)?$/);
		await act(async () => state.onFullScreenChange?.(false));
		expect(controls?.style.paddingInlineStart).toBe(inset);
	});
});

function appRegion(element: HTMLElement | null | undefined) {
	return (
		element?.style as
			| (CSSStyleDeclaration & { WebkitAppRegion?: string })
			| undefined
	)?.WebkitAppRegion;
}
