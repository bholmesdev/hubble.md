// @vitest-environment happy-dom
import { useStoreValue } from "@simplestack/store/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type ChatDelta, type ChatResult, chatInput } from "../desktopApi/chat";
import { chatConnection } from "../store/chatConnection";
import { getInitialState, STORAGE_KEY, serialize } from "../store/persistence";
import {
	appStore,
	cleanFileState,
	emptyDoc,
	viewerStore,
} from "../store/state";
import { chatPanelOpen } from "../store/tabChat";
import { tabsStore } from "../store/tabStore";
import { emptyTabs, withOpenedTab } from "../store/tabs";
import { ChatConnectionSettings } from "./ChatConnectionSettings";
import { ChatPanel, TOGGLE_CHAT_EVENT } from "./ChatPanel";

const mocks = vi.hoisted(() => ({
	api: {
		chatAccount: vi.fn(),
		chatSignIn: vi.fn(),
		chatDisconnect: vi.fn(),
		chatModels: vi.fn(),
		chatSend: vi.fn(),
		chatStop: vi.fn(),
		onChatDelta: vi.fn(),
	},
}));
vi.mock("../desktopApi", () => ({ desktopApi: mocks.api }));
let host: HTMLDivElement;
let root: Root;
let delta: (event: ChatDelta) => void;
let finish: (result: ChatResult) => void;

beforeEach(async () => {
	vi.clearAllMocks();
	localStorage.clear();
	appStore.set((state) => ({
		...state,
		workspace: { ...state.workspace, workspacePath: null },
	}));
	viewerStore.set({
		...emptyDoc(),
		currentPath: "/notes/note.md",
		...cleanFileState(""),
	});
	chatPanelOpen.set(false);
	tabsStore.set(withOpenedTab(emptyTabs(), "/notes/note.md"));
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	chatConnection.set({
		account: null,
		models: [],
		busy: false,
		signingIn: false,
		sending: false,
		revision: 0,
		error: null,
	});
	mocks.api.chatAccount.mockResolvedValue({
		connected: true,
		sharing: true,
		label: "Test account",
		expiresAt: Date.now() + 3600000,
	});
	mocks.api.chatModels.mockResolvedValue([
		{ slug: "model", name: "Available model" },
	]);
	mocks.api.onChatDelta.mockImplementation((callback) => {
		delta = callback;
		return vi.fn();
	});
	mocks.api.chatSend.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	mocks.api.chatStop.mockResolvedValue(undefined);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () =>
		root.render(
			<>
				<TabChat />
				<ChatConnectionSettings />
			</>,
		),
	);
	await act(async () => window.dispatchEvent(new Event(TOGGLE_CHAT_EVENT)));
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

function TabChat() {
	const { activeTabId } = useStoreValue(tabsStore);
	return (
		<ChatPanel
			key={activeTabId}
			tabId={activeTabId}
			onOpenSettings={() => {}}
		/>
	);
}

function button(text: string) {
	const element = [...host.querySelectorAll("button")].find(
		(button) => button.textContent === text,
	);
	if (!element) throw new Error(`Missing button: ${text}`);
	return element;
}

async function fillDraft(text: string) {
	const textarea = host.querySelector("textarea");
	if (!textarea) throw new Error("Missing composer");
	await act(async () => {
		const setValue = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set;
		if (!setValue) throw new Error("Missing textarea value setter");
		setValue.call(textarea, text);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function sendMessage(text = "Explain this") {
	await fillDraft(text);
	await act(async () => button("Send").click());
}

it("sends messages and streams the matching reply", async () => {
	await sendMessage();
	const request = mocks.api.chatSend.mock.calls[0][0];
	expect(request.messages).toEqual([
		expect.objectContaining({
			text: "Explain this",
			role: "user",
			status: "complete",
		}),
	]);
	expect(request.messages[0]).not.toHaveProperty("quotes");
	await act(async () => delta({ id: "another-request", text: "Wrong reply" }));
	expect(host.textContent).not.toContain("Wrong reply");
	await act(async () => delta({ id: request.id, text: "Streamed reply" }));
	expect(host.textContent).toContain("Streamed reply");
	await act(async () => finish({ status: "complete", text: "Finished reply" }));
	expect(host.textContent).toContain("Finished reply");
	expect(button("Send")).toBeDefined();
});

it("stops the request when its tab changes and ignores late output", async () => {
	await sendMessage();
	const request = mocks.api.chatSend.mock.calls[0][0];
	const originalTab = tabsStore.get().activeTabId;
	await act(async () => delta({ id: request.id, text: "Partial reply" }));
	await act(async () => {
		tabsStore.set(withOpenedTab(tabsStore.get(), "/other/file.md", "new"));
		root.render(
			<ChatPanel
				key="another-tab"
				tabId={tabsStore.get().activeTabId}
				onOpenSettings={() => {}}
			/>,
		);
	});

	expect(mocks.api.chatStop).toHaveBeenCalledWith(request.id);
	await act(async () => finish({ status: "complete", text: "Late reply" }));
	expect(host.textContent).not.toContain("Late reply");
	await act(async () =>
		root.render(
			<ChatPanel
				key="original-tab"
				tabId={originalTab}
				onOpenSettings={() => {}}
			/>,
		),
	);
	expect(host.textContent).toContain("Partial reply");
	expect(host.textContent).toContain("Stopped");
	expect(host.textContent).not.toContain("Late reply");
});

it("clears a signed-out conversation and picks up a reconnected account from Settings", async () => {
	await sendMessage();
	await act(async () =>
		finish({ status: "complete", text: "Previous conversation" }),
	);
	mocks.api.chatDisconnect.mockResolvedValue(undefined);
	await act(async () => button("Sign out").click());
	expect(mocks.api.chatDisconnect).toHaveBeenCalledOnce();
	expect(host.textContent).not.toContain("Previous conversation");
	expect(host.querySelector("aside")?.textContent).toContain(
		"Sign in with ChatGPT",
	);
	mocks.api.chatSignIn.mockResolvedValue({
		connected: true,
		sharing: true,
		label: "Reconnected account",
		expiresAt: Date.now() + 3600000,
	});
	mocks.api.chatModels.mockResolvedValue([
		{ slug: "new-model", name: "New available model" },
	]);
	const signIn = host.querySelector("section button[data-oai-siwc-button]");
	if (!(signIn instanceof HTMLButtonElement))
		throw new Error("Missing settings sign-in button");
	await act(async () => signIn.click());
	expect(host.querySelector("select")?.value).toBe("new-model");
	await sendMessage();
	expect(mocks.api.chatSend.mock.calls[1][0]).toMatchObject({
		model: "new-model",
		messages: [{ text: "Explain this", role: "user", status: "complete" }],
	});
});

it("shows each tab’s own conversation and draft when switching tabs", async () => {
	const first = tabsStore.get().activeTabId;
	await sendMessage("Message A");
	await act(async () => finish({ status: "complete", text: "Reply A" }));
	await fillDraft("Draft A");
	await act(async () =>
		tabsStore.set(withOpenedTab(tabsStore.get(), "/notes/other.md", "new")),
	);
	expect(host.querySelector("textarea")?.value).toBe("");
	expect(host.textContent).not.toContain("Reply A");
	await act(async () =>
		viewerStore.set((doc) => ({ ...doc, currentPath: "/notes/other.md" })),
	);
	await sendMessage("Message B");
	await act(async () => finish({ status: "complete", text: "Reply B" }));
	await fillDraft("Draft B");
	await act(async () =>
		tabsStore.set((tabs) => ({ ...tabs, activeTabId: first })),
	);
	expect(host.querySelector("textarea")?.value).toBe("Draft A");
	expect(host.textContent).toContain("Reply A");
	expect(host.textContent).not.toContain("Reply B");
});

it("appends immutable file snapshots, reuses unchanged text, and follows files within a tab", async () => {
	await act(async () =>
		viewerStore.set({
			...emptyDoc(),
			currentPath: "/notes/note.md",
			...cleanFileState("Leonardo lived in Milan."),
		}),
	);
	await sendMessage("Read this");
	const first = mocks.api.chatSend.mock.calls[0][0];
	expect(chatInput(first.messages)[0].content).toContain(
		"Leonardo lived in Milan.",
	);
	await act(async () => finish({ status: "complete", text: "Read it" }));
	await sendMessage("Tell me more");
	const second = mocks.api.chatSend.mock.calls[1][0];
	expect(chatInput(second.messages).slice(0, 1)).toEqual(
		chatInput(first.messages),
	);
	expect(
		JSON.stringify(chatInput(second.messages)).match(
			/Leonardo lived in Milan\./g,
		),
	).toHaveLength(1);
	await act(async () => {
		finish({ status: "complete", text: "More detail" });
		viewerStore.set((doc) => ({
			...doc,
			content: "Leonardo painted in Milan.",
		}));
	});
	await sendMessage("Review my unsaved edit");
	const third = mocks.api.chatSend.mock.calls[2][0];
	expect(chatInput(third.messages).slice(0, second.messages.length)).toEqual(
		chatInput(second.messages),
	);
	expect(chatInput(third.messages).slice(-1)[0]?.content).toContain(
		"Leonardo painted in Milan.",
	);
	await act(async () => {
		finish({ status: "complete", text: "Reviewed" });
		tabsStore.set(withOpenedTab(tabsStore.get(), "/notes/other.md"));
		viewerStore.set({
			...emptyDoc(),
			currentPath: "/notes/other.md",
			...cleanFileState("Another note"),
		});
	});
	await sendMessage("Compare these");
	expect(
		chatInput(mocks.api.chatSend.mock.calls[3][0].messages).slice(-1)[0]
			?.content,
	).toContain("Another note");
	await act(async () => {
		finish({ status: "complete", text: "Compared" });
		tabsStore.set(withOpenedTab(tabsStore.get(), "/notes/note.md"));
		viewerStore.set({
			...emptyDoc(),
			currentPath: "/notes/note.md",
			...cleanFileState("Leonardo painted in Milan."),
		});
	});
	await sendMessage("Back to Leonardo");
	const last = chatInput(mocks.api.chatSend.mock.calls[4][0].messages);
	expect(last.slice(-1)[0]?.content).toContain("/notes/note.md");
	expect(
		JSON.stringify(last).match(/Leonardo painted in Milan\./g),
	).toHaveLength(1);
	await act(async () => finish({ status: "complete", text: "Back" }));
	await act(async () =>
		tabsStore.set(withOpenedTab(tabsStore.get(), "/notes/renamed.md")),
	);
	await act(async () =>
		viewerStore.set((doc) => ({ ...doc, currentPath: "/notes/renamed.md" })),
	);
	await sendMessage("Renamed");
	const renamed = chatInput(mocks.api.chatSend.mock.calls[5][0].messages);
	expect(renamed.slice(-1)[0]?.content).toContain("/notes/renamed.md");
	expect(
		JSON.stringify(renamed).match(/Leonardo painted in Milan\./g),
	).toHaveLength(1);
});

it("keeps file context independent per tab and restores snapshots from local storage", async () => {
	await act(async () =>
		viewerStore.set({
			...emptyDoc(),
			currentPath: "/notes/note.md",
			...cleanFileState("Shared file contents"),
		}),
	);
	await sendMessage("First tab");
	const first = mocks.api.chatSend.mock.calls[0][0];
	await act(async () => finish({ status: "complete", text: "First reply" }));
	appStore.set((state) => ({
		...state,
		workspace: { ...state.workspace, workspacePath: "/notes" },
	}));
	const saved = serialize(appStore.get());
	localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
	const restored = getInitialState();
	const firstId = tabsStore.get().activeTabId;
	if (!firstId) throw new Error("Missing first tab");
	expect(
		chatInput(restored.tabs.byId[firstId].chat?.messages ?? [])[0].content,
	).toContain("Shared file contents");
	await act(async () => {
		appStore.set({ ...restored, document: viewerStore.get() });
		tabsStore.set(withOpenedTab(tabsStore.get(), "/notes/second.md", "new"));
		viewerStore.set((doc) => ({ ...doc, currentPath: "/notes/second.md" }));
	});
	await sendMessage("Second tab");
	const second = mocks.api.chatSend.mock.calls[1][0];
	expect(second.messages).toHaveLength(1);
	expect(chatInput(second.messages)[0].content).toContain(
		"Shared file contents",
	);
	await act(async () => {
		finish({ status: "complete", text: "Second reply" });
		tabsStore.set((tabs) => ({ ...tabs, activeTabId: firstId }));
		viewerStore.set((doc) => ({ ...doc, currentPath: "/notes/note.md" }));
	});
	await sendMessage("Continue first tab");
	const resumed = chatInput(mocks.api.chatSend.mock.calls[2][0].messages);
	expect(resumed[0]).toEqual(chatInput(first.messages)[0]);
	expect(JSON.stringify(resumed).match(/Shared file contents/g)).toHaveLength(
		1,
	);
	expect(JSON.stringify(resumed)).not.toContain("Second tab");
});

it("waits for the active file to load and counts file contents against the context limit", async () => {
	await act(async () =>
		viewerStore.set({
			...emptyDoc(),
			currentPath: "/notes/note.md",
			status: "loading",
		}),
	);
	await sendMessage();
	expect(mocks.api.chatSend).not.toHaveBeenCalled();
	await act(async () =>
		viewerStore.set((doc) => ({
			...doc,
			...cleanFileState("x".repeat(80_000)),
		})),
	);
	await sendMessage();
	expect(mocks.api.chatSend).not.toHaveBeenCalled();
	expect(host.textContent).toContain("Chat is too long");
	expect(host.querySelector("textarea")?.value).toBe("Explain this");
});

it("does not attach a stale editor buffer or pretend a binary file is included", async () => {
	await act(async () =>
		viewerStore.set({
			...emptyDoc(),
			currentPath: "/notes/previous.md",
			...cleanFileState("Stale private buffer"),
		}),
	);
	await sendMessage();
	expect(mocks.api.chatSend).not.toHaveBeenCalled();
	await act(async () =>
		tabsStore.set(withOpenedTab(tabsStore.get(), "/notes/image.png")),
	);
	await sendMessage("What can you see?");
	const input = chatInput(mocks.api.chatSend.mock.calls[0][0].messages);
	expect(JSON.stringify(input)).not.toContain("Stale private buffer");
	expect(input.slice(-1)[0]?.content).toContain("No current file attached");
});

it("starts a fresh snapshot history when New chat is clicked", async () => {
	await act(async () =>
		viewerStore.set({
			...emptyDoc(),
			currentPath: "/notes/note.md",
			...cleanFileState("A note"),
		}),
	);
	await sendMessage("First conversation");
	await act(async () => finish({ status: "complete", text: "Reply" }));
	const newChat = host.querySelector<HTMLButtonElement>(
		'button[aria-label="New chat"]',
	);
	if (!newChat) throw new Error("Missing New chat");
	await act(async () => newChat.click());
	await sendMessage("Fresh conversation");
	const request = mocks.api.chatSend.mock.calls[1][0];
	expect(request.messages).toHaveLength(1);
	expect(chatInput(request.messages)[0].content).toContain("A note");
});
