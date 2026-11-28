import { afterEach, expect, it, vi } from "vitest";
import type { ChatConversation } from "../desktopApi/chat";
import { createDesktopApi, loadStoreActions } from "./testUtils";

async function setup() {
	const api = createDesktopApi();
	api.pathExists.mockResolvedValue(true);
	const app = await loadStoreActions(api);
	const { updateTabChat } = await import("./tabChat");
	function current() {
		const { activeTabId, byId } = app.tabsStore.get();
		if (!activeTabId) throw new Error("Expected an active tab");
		return { id: activeTabId, ...byId[activeTabId] };
	}
	function setConversation(label: string) {
		const chat: ChatConversation = {
			messages: [
				{
					id: crypto.randomUUID(),
					role: "user",
					text: label,
					status: "complete",
				},
			],
			draft: `Draft ${label}`,
			model: "test-model",
		};
		updateTabChat(current().id, () => chat);
		return chat;
	}
	return { ...app, current, setConversation };
}

afterEach(() => vi.unstubAllGlobals());

it("keeps the conversation when another file replaces the tab’s current file", async () => {
	const app = await setup();
	await app.loadPath("/notes/a.md");
	const id = app.current().id;
	const chat = app.setConversation("A");
	await app.loadPath("/notes/b.md");
	expect(app.current()).toMatchObject({ id, path: "/notes/b.md", chat });
});

it("keeps the conversation when its file is renamed", async () => {
	const app = await setup();
	await app.openWorkspace("/notes");
	await app.loadPath("/notes/a.md");
	const id = app.current().id;
	const chat = app.setConversation("A");
	await app.renameMarkdownFile("/notes/a.md", "renamed");
	expect(app.current()).toMatchObject({ id, path: "/notes/renamed.md", chat });
});

it("restores each workspace’s tab conversations and drafts independently", async () => {
	const app = await setup();
	await app.openWorkspace("/one");
	await app.loadPath("/one/a.md");
	const firstId = app.current().id;
	const firstChat = app.setConversation("A");
	await app.openWorkspace("/two");
	await app.loadPath("/two/b.md");
	expect(app.current().chat).toBeUndefined();
	const secondId = app.current().id;
	const secondChat = app.setConversation("B");
	await app.openWorkspace("/one");
	expect(app.current()).toMatchObject({ id: firstId, chat: firstChat });
	await app.openWorkspace("/two");
	expect(app.current()).toMatchObject({ id: secondId, chat: secondChat });
});

it("discards a closed tab’s chat without clearing another tab’s conversation", async () => {
	const app = await setup();
	await app.loadPath("/notes/a.md");
	const closedId = app.current().id;
	app.setConversation("A");
	await app.openTabForPath("/notes/b.md");
	const survivor = app.setConversation("B");
	await app.closeTab(closedId);
	expect(app.current().chat).toEqual(survivor);
	await app.openTabForPath("/notes/a.md");
	expect(app.current().id).not.toBe(closedId);
	expect(app.current().chat).toBeUndefined();
});

it("keeps duplicate file tabs and independent chats through navigation and restart", async () => {
	const app = await setup();
	await app.openWorkspace("/notes");
	await app.loadPath("/notes/a.md");
	const first = app.current().id;
	const firstChat = app.setConversation("A");
	await app.openTabForPath("/notes/b.md");
	const second = app.current().id;
	const secondChat = app.setConversation("B");
	await app.loadPath("/notes/a.md");
	expect(app.current()).toMatchObject({ id: second, chat: secondChat });
	await app.goBack();
	expect(app.current()).toMatchObject({ id: second, path: "/notes/b.md" });
	await app.goForward();
	expect(app.current()).toMatchObject({ id: second, path: "/notes/a.md" });
	const { serialize } = await import("./persistence");
	const api = createDesktopApi();
	api.pathExists.mockResolvedValue(true);
	const restored = await loadStoreActions(
		api,
		JSON.stringify(serialize(app.appStore.get())),
	);
	await restored.restoreTabs();
	expect(restored.tabsStore.get()).toMatchObject({
		order: [first, second],
		activeTabId: second,
		byId: {
			[first]: { path: "/notes/a.md", chat: firstChat },
			[second]: { path: "/notes/a.md", chat: secondChat },
		},
	});
	await restored.renameMarkdownFile("/notes/a.md", "renamed");
	expect(
		restored.tabsStore
			.get()
			.order.map((id) => restored.tabsStore.get().byId[id].path),
	).toEqual(["/notes/renamed.md", "/notes/renamed.md"]);
	await restored.openWorkspace("/other");
	await restored.openWorkspace("/notes");
	expect(restored.tabsStore.get().activeTabId).toBe(second);
	expect(restored.tabsStore.get().byId[first].chat).toEqual(firstChat);
	expect(restored.tabsStore.get().byId[second].chat).toEqual(secondChat);
	await restored.closeTab(second);
	expect(restored.tabsStore.get().activeTabId).toBe(first);
	expect(restored.tabsStore.get().byId[first].chat).toEqual(firstChat);
	await restored.reopenClosedTab();
	const reopened = restored.tabsStore.get().activeTabId;
	expect(reopened).not.toBe(first);
	expect(reopened).not.toBe(second);
	expect(restored.tabsStore.get().byId[reopened ?? ""].chat).toBeUndefined();
	expect(restored.tabsStore.get().byId[first].chat).toEqual(firstChat);
});
