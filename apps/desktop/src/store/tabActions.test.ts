import { describe, expect, it, vi } from "vitest";

import { createDesktopApi, loadStoreActions } from "./testUtils";

describe("desktop tabs", () => {
	it("keeps navigation history separate per tab", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { activateTab, appStore, canGoBack, loadPath, openTabForPath } =
			await loadStoreActions(api);
		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		const firstTabId = appStore.get().tabs.activeTabId;
		expect(canGoBack()).toBe(true);
		await openTabForPath("/workspace/c.md");
		expect(canGoBack()).toBe(false);
		if (!firstTabId) throw new Error("expected a tab");
		await activateTab(firstTabId);
		expect(canGoBack()).toBe(true);
	});

	it("blocks closing a tab while its note has a disk conflict", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, closeTab, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await openTabForPath("/workspace/b.md");
		const conflicted = appStore.get().tabs.activeTabId;
		if (!conflicted) throw new Error("expected a tab");
		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				externalChange: { kind: "conflict", diskContent: "disk" },
			},
		}));

		await closeTab(conflicted);

		expect(appStore.get().tabs.order).toContain(conflicted);
		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
	});

	it("reuses the active tab when opening another file", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockResolvedValue("content");
		const { appStore, loadPath } = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const firstId = appStore.get().tabs.activeTabId;
		await loadPath("/workspace/b.md");

		const { order, activeTabId, byId } = appStore.get().tabs;
		expect(order).toEqual([firstId]);
		expect(activeTabId).toBe(firstId);
		expect(byId[order[0]].path).toBe("/workspace/b.md");
	});

	it("keeps the tab pointing at the open document when a load fails", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(async (path: string) => {
			if (path === "/workspace/missing.md") throw new Error("ENOENT");
			return "content";
		});
		const { appStore, loadPath, viewerStore } = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/missing.md");

		const { order, byId } = appStore.get().tabs;
		expect(order).toHaveLength(1);
		expect(byId[order[0]].path).toBe("/workspace/a.md");
		expect(viewerStore.get().currentPath).toBe("/workspace/a.md");
	});

	it("closes tabs when the viewer is cleared", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockResolvedValue("content");
		const { appStore, clearViewer, loadPath } = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		clearViewer();

		expect(appStore.get().tabs.order).toEqual([]);
		expect(appStore.get().tabs.activeTabId).toBeNull();
	});

	it.each([
		null,
		"/workspace",
	])("restores ordered tabs after relaunch in %s", async (workspace) => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const first = await loadStoreActions(api);
		if (workspace) await first.openWorkspace(workspace);
		await first.openTabForPath("/workspace/a.md");
		await first.openTabForPath("/workspace/b.md");
		await first.openBackgroundTab("/workspace/c.md");
		const paths = first.tabsStore
			.get()
			.order.map((id) => first.tabsStore.get().byId[id].path);
		const [, written] = vi.mocked(localStorage.setItem).mock.lastCall ?? [];
		const second = await loadStoreActions(api, written);
		await second.restoreTabs();
		expect(
			second.tabsStore
				.get()
				.order.map((id) => second.tabsStore.get().byId[id].path),
		).toEqual(paths);
		expect(second.viewerStore.get().currentPath).toBe("/workspace/b.md");
		const active = second.tabsStore.get().activeTabId;
		expect(active && second.tabsStore.get().byId[active].path).toBe(
			"/workspace/b.md",
		);
		await second.openTabForPath("/workspace/d.md");
		expect(new Set(second.tabsStore.get().order).size).toBe(4);
	});

	it("restores each workspace's tabs independently", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const app = await loadStoreActions(api);
		await app.openWorkspace("/one");
		await app.openTabForPath("/one/a.md");
		await app.openTabForPath("/one/b.md");
		await app.openWorkspace("/two");
		await app.openTabForPath("/two/c.md");
		await app.openWorkspace("/one");
		expect(
			app.tabsStore.get().order.map((id) => app.tabsStore.get().byId[id].path),
		).toEqual(["/one/a.md", "/one/b.md"]);
		expect(app.viewerStore.get().currentPath).toBe("/one/b.md");
		await app.openWorkspace("/two");
		expect(
			app.tabsStore.get().order.map((id) => app.tabsStore.get().byId[id].path),
		).toEqual(["/two/c.md"]);
	});

	it("saves pending edits before switching workspace sessions", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const app = await loadStoreActions(api);
		await app.openWorkspace("/one");
		await app.openTabForPath("/one/a.md");
		app.viewerStore.set((state) => ({ ...state, content: "pending edit" }));
		await app.openWorkspace("/two");
		expect(api.writeFileText).toHaveBeenCalledWith("/one/a.md", "pending edit");
		expect(app.workspaceStore.get().workspacePath).toBe("/two");
	});

	it("keeps an intentionally empty tab session empty on reload", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const first = await loadStoreActions(api);
		await first.openWorkspace("/workspace");
		await first.openTabForPath("/workspace/a.md");
		await first.closeAllTabs();
		const [, written] = vi.mocked(localStorage.setItem).mock.lastCall ?? [];
		const second = await loadStoreActions(api, written);
		await second.restoreTabs();
		expect(second.tabsStore.get().order).toEqual([]);
		expect(second.viewerStore.get().currentPath).toBeNull();
	});

	it("skips missing saved files and selects a surviving tab", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const first = await loadStoreActions(api);
		await first.openWorkspace("/workspace");
		await first.openTabForPath("/workspace/a.md");
		await first.openTabForPath("/workspace/b.md");
		const [, written] = vi.mocked(localStorage.setItem).mock.lastCall ?? [];
		api.pathExists.mockImplementation(
			async (path: string) => path !== "/workspace/b.md",
		);
		const second = await loadStoreActions(api, written);
		await second.restoreTabs();
		expect(
			second.tabsStore
				.get()
				.order.map((id) => second.tabsStore.get().byId[id].path),
		).toEqual(["/workspace/a.md"]);
		expect(second.viewerStore.get().currentPath).toBe("/workspace/a.md");
	});

	it("reopens closed tabs in order and restores their position after relaunch", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const app = await loadStoreActions(api);
		await app.openTabForPath("/workspace/a.md");
		await app.openTabForPath("/workspace/b.md");
		await app.openTabForPath("/workspace/c.md");
		await app.closeTab(app.tabsStore.get().order[1]);
		await app.closeActiveTab();
		const [, written] = vi.mocked(localStorage.setItem).mock.lastCall ?? [];
		const restored = await loadStoreActions(api, written);
		await restored.restoreTabs();
		await Promise.all([restored.reopenClosedTab(), restored.reopenClosedTab()]);
		const tabs = restored.tabsStore.get();
		expect(tabs.order.map((id) => tabs.byId[id].path)).toEqual([
			"/workspace/a.md",
			"/workspace/b.md",
			"/workspace/c.md",
		]);
		expect(restored.viewerStore.get().currentPath).toBe("/workspace/b.md");
		expect(tabs.closed).toEqual([]);
	});

	it("keeps a closed tab when saving the current document fails", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const app = await loadStoreActions(api);
		await app.openTabForPath("/workspace/a.md");
		await app.openTabForPath("/workspace/b.md");
		await app.closeActiveTab();
		app.viewerStore.set((state) => ({ ...state, content: "unsaved edit" }));
		api.writeFileText.mockRejectedValue(new Error("disk full"));
		await app.reopenClosedTab();
		expect(app.viewerStore.get().currentPath).toBe("/workspace/a.md");
		expect(app.tabsStore.get().closed).toEqual([
			{ path: "/workspace/b.md", index: 1 },
		]);
	});

	it("skips missing closed files and reopens the changelog without disk access", async () => {
		const api = createDesktopApi();
		const app = await loadStoreActions(api);
		await app.openChangelog();
		await app.closeActiveTab();
		await app.openTabForPath("/workspace/missing.md");
		await app.closeActiveTab();
		api.pathExists.mockResolvedValue(false);
		api.readFileText.mockClear();
		await app.reopenClosedTab();
		expect(app.viewerStore.get().currentPath).toBe("hubble://changelog");
		expect(app.tabsStore.get().closed).toEqual([]);
		expect(api.pathExists).not.toHaveBeenCalledWith("hubble://changelog");
		expect(api.readFileText).not.toHaveBeenCalled();
	});

	it("starts empty when no tab session has been saved", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const app = await loadStoreActions(
			api,
			JSON.stringify({
				workspace: {
					workspacePath: "/workspace",
				},
			}),
		);
		await app.restoreTabs();
		expect(app.viewerStore.get().currentPath).toBeNull();
		expect(app.tabsStore.get().order).toEqual([]);
	});

	it("ignores malformed saved sessions and deduplicates valid paths", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		const app = await loadStoreActions(
			api,
			JSON.stringify({
				workspace: { workspacePath: "/workspace" },
				tabSessions: {
					"/broken": null,
					"/workspace": {
						paths: [
							"/workspace/a.md",
							null,
							5,
							"/workspace/a.md",
							"/workspace/b.md",
						],
						activePath: "/missing.md",
					},
				},
			}),
		);
		await app.restoreTabs();
		expect(
			app.tabsStore.get().order.map((id) => app.tabsStore.get().byId[id].path),
		).toEqual(["/workspace/a.md", "/workspace/b.md"]);
		expect(app.viewerStore.get().currentPath).toBe("/workspace/a.md");
	});

	it("opens a second tab beside the active one", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockResolvedValue("content");
		const { appStore, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const first = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/b.md");

		const { order, activeTabId, byId } = appStore.get().tabs;
		expect(order).toHaveLength(2);
		expect(order[0]).toBe(first);
		expect(activeTabId).toBe(order[1]);
		expect(byId[order[0]].path).toBe("/workspace/a.md");
		expect(byId[order[1]].path).toBe("/workspace/b.md");
		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
	});

	it("opens a background tab to the right without switching notes", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockResolvedValue("content");
		const { appStore, loadPath, openBackgroundTab, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const first = appStore.get().tabs.activeTabId;
		await openBackgroundTab("/workspace/b.md");
		await openBackgroundTab("/workspace/b.md");

		const { order, activeTabId, byId } = appStore.get().tabs;
		expect(order).toHaveLength(2);
		expect(activeTabId).toBe(first);
		expect(order[1] && byId[order[1]]?.path).toBe("/workspace/b.md");
		expect(viewerStore.get().currentPath).toBe("/workspace/a.md");
		expect(api.readFileText).toHaveBeenCalledTimes(1);
	});

	it("lets Back return to a background tab after the first navigation", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const {
			activateTab,
			appStore,
			canGoBack,
			goBack,
			loadPath,
			openBackgroundTab,
			viewerStore,
		} = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await openBackgroundTab("/workspace/b.md");
		const background = appStore.get().tabs.order[1];
		if (!background) throw new Error("expected a background tab");

		await activateTab(background);
		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
		expect(canGoBack()).toBe(false);

		await loadPath("/workspace/c.md");
		expect(viewerStore.get().currentPath).toBe("/workspace/c.md");
		expect(canGoBack()).toBe(true);

		await goBack();
		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
	});

	it("focuses the open tab instead of opening the same note twice", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockResolvedValue("content");
		const { appStore, loadPath, openTabForPath } = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const first = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/b.md");
		// Two tabs on one note would give it two autosave timers.
		await openTabForPath("/workspace/a.md");

		expect(appStore.get().tabs.order).toHaveLength(2);
		expect(appStore.get().tabs.activeTabId).toBe(first);

		await loadPath("/workspace/b.md");
		expect(appStore.get().tabs.order).toHaveLength(2);
		expect(appStore.get().tabs.activeTabId).not.toBe(first);
		expect(appStore.get().tabs.activeTabId).toBe(appStore.get().tabs.order[1]);
	});

	it("closing the active tab moves to the next one and opens it", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, closeTab, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const first = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/b.md");
		const second = appStore.get().tabs.activeTabId;
		if (!first || !second) throw new Error("expected two tabs");

		await closeTab(second);

		expect(appStore.get().tabs.order).toEqual([first]);
		expect(appStore.get().tabs.activeTabId).toBe(first);
		expect(viewerStore.get().currentPath).toBe("/workspace/a.md");
	});

	it("rewrites a background tab when its file is renamed", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		api.listDirectory.mockResolvedValue({ files: [], folders: [] });
		const { appStore, loadPath, openTabForPath, renameMarkdownFile } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: { ...current.workspace, workspacePath: "/workspace" },
		}));
		await loadPath("/workspace/a.md");
		const background = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/b.md");

		// Renaming a note nobody is looking at still has to move its tab.
		await renameMarkdownFile("/workspace/a.md", "renamed");

		if (!background) throw new Error("expected a tab");
		expect(appStore.get().tabs.byId[background].path).toBe(
			"/workspace/renamed.md",
		);
	});

	it("closes a background tab when its file is deleted, and reopens it on undo", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		api.listDirectory.mockResolvedValue({ files: [], folders: [] });
		const toast = Object.assign(
			vi.fn(() => "delete-undo"),
			{
				dismiss: vi.fn(),
				success: vi.fn(),
				error: vi.fn(),
			},
		);
		vi.doMock("sonner", () => ({ toast }));
		const {
			appStore,
			deleteSidebarItems,
			loadPath,
			openTabForPath,
			undoDelete,
		} = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: { ...current.workspace, workspacePath: "/workspace" },
		}));
		await loadPath("/workspace/a.md");
		const background = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/b.md");
		const visible = appStore.get().tabs.activeTabId;

		await deleteSidebarItems([{ kind: "file", path: "/workspace/a.md" }]);

		expect(appStore.get().tabs.order).toEqual([visible]);

		await undoDelete();

		// Undo puts the closed tab back where it was, ahead of the visible one.
		expect(appStore.get().tabs.order).toEqual([background, visible]);
		vi.doUnmock("sonner");
	});

	it("leaves no document behind when tabs are closed back to back", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, closeTab, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await openTabForPath("/workspace/b.md");
		await openTabForPath("/workspace/c.md");
		const open = [...appStore.get().tabs.order];
		expect(open).toHaveLength(3);

		// Closing without awaiting each one is what a user does with a fast
		// double click. Every close must see the strip the one before it left.
		await Promise.all(open.map((id) => closeTab(id)));

		expect(appStore.get().tabs.order).toEqual([]);
		expect(appStore.get().tabs.activeTabId).toBeNull();
		// The editor must not still be holding a note that has no tab.
		expect(viewerStore.get().currentPath).toBeNull();
	});

	it("does not reload the note already in front", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { activateTab, appStore, loadPath } = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const only = appStore.get().tabs.activeTabId;
		if (!only) throw new Error("expected a tab");
		api.readFileText.mockClear();

		await activateTab(only);

		// Re-reading would reset undo and view mode for a click that changed
		// nothing.
		expect(api.readFileText).not.toHaveBeenCalled();
	});

	it("opens the changelog as a tab", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { activateTab, appStore, loadPath, openChangelog, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const noteTab = appStore.get().tabs.activeTabId;
		if (!noteTab) throw new Error("expected a tab");
		expect(await openChangelog()).toBe(true);
		const changelogTab = appStore.get().tabs.activeTabId;

		expect(changelogTab).not.toBe(noteTab);
		expect(viewerStore.get().currentPath).toBe("hubble://changelog");
		expect(appStore.get().tabs.order).toEqual([noteTab, changelogTab]);
		expect(changelogTab && appStore.get().tabs.byId[changelogTab].path).toBe(
			"hubble://changelog",
		);
		expect(api.readFileText).not.toHaveBeenCalledWith("hubble://changelog");

		await activateTab(noteTab);
		expect(viewerStore.get().currentPath).toBe("/workspace/a.md");
		expect(await openChangelog()).toBe(true);
		expect(appStore.get().tabs.order).toEqual([noteTab, changelogTab]);
	});

	it("closes the other tabs without disturbing the one in front", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, closeOtherTabs, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await openTabForPath("/workspace/b.md");
		await openTabForPath("/workspace/c.md");
		const kept = appStore.get().tabs.activeTabId;

		await closeOtherTabs();

		expect(appStore.get().tabs.order).toEqual([kept]);
		expect(viewerStore.get().currentPath).toBe("/workspace/c.md");
	});

	it("closes other tabs around a chosen tab", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, closeOtherTabs, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await openTabForPath("/workspace/b.md");
		const kept = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/c.md");
		if (!kept) throw new Error("expected a tab");
		await closeOtherTabs(kept);

		expect(appStore.get().tabs.order).toEqual([kept]);
		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
	});

	it("closes only tabs to the left of a chosen tab", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, closeTabsToLeft, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await openTabForPath("/workspace/b.md");
		const target = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/c.md");
		if (!target) throw new Error("expected a tab");
		await closeTabsToLeft(target);

		const tabs = appStore.get().tabs;
		expect(tabs.order.map((id) => tabs.byId[id].path)).toEqual([
			"/workspace/b.md",
			"/workspace/c.md",
		]);
		expect(viewerStore.get().currentPath).toBe("/workspace/c.md");
	});

	it("closes every tab and empties the editor", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, closeAllTabs, loadPath, openTabForPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await openTabForPath("/workspace/b.md");

		await closeAllTabs();

		expect(appStore.get().tabs.order).toEqual([]);
		expect(viewerStore.get().currentPath).toBeNull();
	});

	it("steps between tabs and wraps at either end", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { activateAdjacentTab, appStore, loadPath, openTabForPath } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		const first = appStore.get().tabs.activeTabId;
		await openTabForPath("/workspace/b.md");
		const second = appStore.get().tabs.activeTabId;

		// Forward from the last tab comes back round to the first.
		await activateAdjacentTab(1);
		expect(appStore.get().tabs.activeTabId).toBe(first);
		await activateAdjacentTab(-1);
		expect(appStore.get().tabs.activeTabId).toBe(second);
	});
});
