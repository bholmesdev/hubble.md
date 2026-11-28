import { afterEach, expect, it, vi } from "vitest";
import type {
	ChatDelta,
	ChatFileRequest,
	ChatRequest,
	ChatResult,
} from "../desktopApi/chat";
import { createDesktopApi, loadStoreActions } from "./testUtils";

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	vi.unstubAllGlobals();
});

async function setup() {
	let delta: (event: ChatDelta) => void = () => {};
	let file: (event: ChatFileRequest) => void = () => {};
	let finish: (value: ChatResult) => void = () => {};
	const api = Object.assign(createDesktopApi(), {
		chatCheckBudget: vi.fn(async () => true),
		chatSend: vi.fn(
			(_request: ChatRequest) =>
				new Promise<ChatResult>((resolve) => {
					finish = resolve;
				}),
		),
		chatStop: vi.fn(async () => {}),
		chatFileReply: vi.fn(async () => {}),
		onChatDelta: vi.fn((callback: typeof delta) => {
			delta = callback;
			return () => {};
		}),
		onChatFileRequest: vi.fn((callback: typeof file) => {
			file = callback;
			return () => {};
		}),
	});
	const app = await loadStoreActions(api);
	await app.loadPath("/notes/a.md");
	const tabId = app.tabsStore.get().activeTabId ?? "";
	const { updateTabChat, chatPanelOpen } = await import("./tabChat");
	chatPanelOpen.set(true);
	updateTabChat(tabId, (chat) => ({ ...chat, draft: "Improve this note" }));
	const { chatConnection } = await import("./chatConnection");
	chatConnection.set({
		...chatConnection.get(),
		account: {
			connected: true,
			sharing: true,
			label: "user",
			expiresAt: Date.now() + 3600000,
		},
		models: [{ slug: "model", name: "Model" }],
	});
	const session = await import("./chatSession");
	cleanup = session.initializeChatSession();
	const current = () => app.tabsStore.get().byId[tabId].chat;
	return {
		...app,
		...session,
		api,
		tabId,
		updateTabChat,
		current,
		delta: (event: ChatDelta) => delta(event),
		finish: (result: ChatResult) => finish(result),
	};
}

it("keeps streamed text and tool activity in the owning tab and retains immutable file snapshots", async () => {
	const s = await setup();
	const pending = s.sendChat(s.tabId, "model");
	await vi.waitFor(() => expect(s.api.chatSend).toHaveBeenCalledOnce());
	const request = s.api.chatSend.mock.calls[0]?.[0] as unknown as {
		id: string;
		messages: { file: { text: string } }[];
	};
	expect(request.messages[0].file.text).toBe("before");
	s.delta({ id: request.id, text: "Reading. ", activity: "Reading files" });
	s.delta({
		id: request.id,
		text: "",
		context: [{ type: "function_call_output", call_id: "read", output: "{}" }],
	});
	expect(s.chatSession.get().activity).toBe("Reading files");
	s.finish({ status: "complete", text: "Done." });
	await pending;
	expect(s.current()?.messages.slice(-1)[0]).toMatchObject({
		text: "Done.",
		status: "complete",
	});
	s.viewerStore.set((doc) => ({ ...doc, content: "Human edit" }));
	expect(s.current()?.messages[0].file?.text).toBe("before");
});

it("preserves a revised draft when token counting completes after the user edits it", async () => {
	const s = await setup();
	let complete: (fits: boolean) => void = () => {};
	s.api.chatCheckBudget.mockImplementation(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	s.api.chatSend.mockResolvedValue({ status: "complete", text: "Unexpected" });
	const pending = s.sendChat(s.tabId, "model");
	s.updateTabChat(s.tabId, (chat) => ({ ...chat, draft: "Revised request" }));
	complete(true);
	await pending;
	expect(s.api.chatSend).not.toHaveBeenCalled();
	expect(s.current()?.draft).toBe("Revised request");
});

it("stops when switching tabs and ignores late streamed output", async () => {
	const s = await setup();
	const pending = s.sendChat(s.tabId, "model");
	await vi.waitFor(() => expect(s.api.chatSend).toHaveBeenCalledOnce());
	const id = s.chatSession.get().request?.id ?? "";
	await s.openTabForPath("/notes/b.md");
	expect(s.api.chatStop).toHaveBeenCalledWith(id);
	s.delta({ id, text: "Late words" });
	s.finish({ status: "stopped", text: "Late words" });
	await pending;
	expect(s.current()?.messages.slice(-1)[0]?.status).toBe("stopped");
	expect(
		s.tabsStore.get().byId[s.tabsStore.get().activeTabId ?? ""].chat,
	).toBeUndefined();
});

it("starts a conversation from a new tab without attaching a file", async () => {
	const s = await setup();
	await s.openNewTabPage();
	const id = s.tabsStore.get().activeTabId ?? "";
	s.updateTabChat(id, (chat) => ({ ...chat, draft: "Help me plan a note" }));
	const pending = s.sendChat(id, "model");
	await vi.waitFor(() => expect(s.api.chatSend).toHaveBeenCalledOnce());
	expect(s.api.chatSend.mock.calls[0]?.[0].messages[0]).toMatchObject({
		text: "Help me plan a note",
		file: null,
	});
	s.finish({ status: "complete", text: "Let's start." });
	await pending;
	expect(s.tabsStore.get().byId[id].chat?.messages).toHaveLength(2);
});
