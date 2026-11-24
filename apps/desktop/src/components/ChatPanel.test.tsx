// @vitest-environment happy-dom
import { useStoreValue } from "@simplestack/store/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type ChatDelta,
	type ChatResult,
	chatInput,
	chatResponseInput,
} from "../desktopApi/chat";
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
		chatReset: vi.fn(),
		openExternalUrl: vi.fn(),
		chatModels: vi.fn(),
		chatSend: vi.fn(),
		chatStop: vi.fn(),
		onChatDelta: vi.fn(),
		onChatFileRequest: vi.fn(() => vi.fn()),
		chatFileReply: vi.fn(),
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

it("keeps tool results after a stopped reply and restores them as model context", async () => {
	await sendMessage("Read another note");
	const request = mocks.api.chatSend.mock.calls[0][0];
	const context = [
		{
			type: "function_call",
			name: "read_file",
			namespace: "workspace",
			call_id: "read",
			arguments: '{"path":"other.md"}',
		},
		{
			type: "function_call_output",
			call_id: "read",
			output: JSON.stringify({
				path: "other.md",
				text: "Tool-only source contents",
				version: "v1",
			}),
		},
	];
	await act(async () =>
		delta({ id: request.id, text: "", context, activity: "Reading a file…" }),
	);
	expect(host.textContent).toContain("Reading a file…");
	await act(async () => finish({ status: "stopped", text: "", context }));
	expect(host.textContent).toContain("Read other.md");
	expect(host.textContent).not.toContain("Tool-only source contents");
	await act(async () =>
		appStore.set((state) => ({
			...state,
			workspace: { ...state.workspace, workspacePath: "/notes" },
		})),
	);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(appStore.get())));
	const saved = getInitialState().tabs;
	const id = saved.activeTabId;
	if (!id) throw new Error("Missing tab");
	const history = saved.byId[id].chat?.messages ?? [];
	expect(chatResponseInput(history)).toContainEqual(context[1]);
});

it("shows sign-in instead of a disabled composer when a saved chat loses its connection", async () => {
	await sendMessage("Saved conversation");
	await act(async () => finish({ status: "complete", text: "Saved reply" }));
	await act(async () =>
		chatConnection.set({
			...chatConnection.get(),
			account: {
				connected: false,
				sharing: false,
				label: "Expired account",
				expiresAt: 0,
			},
			models: [],
		}),
	);
	expect(host.querySelector("aside")?.textContent).toContain(
		"Sign in with ChatGPT",
	);
	expect(host.querySelector("aside textarea")).toBeNull();
	expect(
		tabsStore.get().byId[tabsStore.get().activeTabId ?? ""].chat?.messages,
	).toHaveLength(2);
	mocks.api.chatSignIn.mockResolvedValue({
		connected: true,
		sharing: true,
		label: "Reconnected",
		expiresAt: Date.now() + 3600000,
	});
	const signIn = host.querySelector<HTMLButtonElement>(
		"aside button[data-oai-siwc-button]",
	);
	if (!signIn) throw new Error("Missing sign-in");
	await act(async () => signIn.click());
	expect(host.querySelector("aside")?.textContent).toContain("Saved reply");
	await fillDraft("Continue");
	expect(button("Send").disabled).toBe(false);
});

it("gives missing models a recovery state, then opens a ready new conversation after retry", async () => {
	await act(async () =>
		chatConnection.set({ ...chatConnection.get(), models: [] }),
	);
	expect(host.querySelector("aside")?.textContent).toContain(
		"No chat models are available",
	);
	expect(host.querySelector("aside textarea")).toBeNull();
	await act(async () => button("Retry connection").click());
	await fillDraft("Now ready");
	expect(button("Send").disabled).toBe(false);
});

it("explains loading and failed file states rather than silently disabling Send", async () => {
	await act(async () =>
		viewerStore.set((doc) => ({ ...doc, status: "loading" })),
	);
	expect(host.querySelector("aside")?.textContent).toContain(
		"Loading the current file",
	);
	await act(async () =>
		viewerStore.set((doc) => ({
			...doc,
			status: "error",
			error: "Could not read the file",
		})),
	);
	expect(host.querySelector("aside")?.textContent).toContain(
		"Could not read the file",
	);
});

it("offers a working reset and sign-in from an unreadable saved connection", async () => {
	const tabId = tabsStore.get().activeTabId;
	if (!tabId) throw new Error("Expected an active tab");
	const { updateTabChat } = await import("../store/tabChat");
	await act(async () => {
		updateTabChat(tabId, (chat) => ({
			...chat,
			messages: [
				{
					id: "saved",
					role: "assistant",
					text: "Saved reply",
					status: "complete",
				},
			],
		}));
		chatConnection.set({
			...chatConnection.get(),
			account: {
				connected: false,
				sharing: false,
				label: null,
				expiresAt: null,
				issue: "unreadable-credentials",
			},
		});
	});
	expect(host.textContent).toContain("saved sign-in");
	expect(host.querySelector("textarea")).toBeNull();
	mocks.api.chatReset.mockRejectedValueOnce(
		new Error("Could not remove the saved sign-in. Try again."),
	);
	await act(async () => button("Reset connection and sign in again").click());
	expect(host.textContent).toContain("Could not remove");
	expect(mocks.api.chatSignIn).not.toHaveBeenCalled();
	mocks.api.chatReset.mockResolvedValueOnce(undefined);
	mocks.api.chatSignIn.mockResolvedValueOnce({
		connected: true,
		sharing: true,
		label: "Test account",
		expiresAt: Date.now() + 3600000,
	});
	await act(async () => button("Reset connection and sign in again").click());
	expect(mocks.api.chatReset).toHaveBeenCalledTimes(2);
	expect(mocks.api.chatSignIn).toHaveBeenCalledTimes(1);
	expect(host.textContent).toContain("Saved reply");
	expect(host.querySelector("textarea")).not.toBeNull();
});

it("renders Markdown as streamed formatting and code fences become complete", async () => {
	await sendMessage();
	const { id } = mocks.api.chatSend.mock.calls[0][0];
	const first = "## Topics\n\n- **Event";
	await act(async () => delta({ id, text: first }));
	expect(host.querySelector("h2")?.textContent).toBe("Topics");
	const rest = " sourcing** and `replay`\n\n```ts\nconst value = 1;";
	await act(async () => delta({ id, text: rest }));
	expect(host.querySelector("strong")?.textContent).toBe("Event sourcing");
	expect(host.querySelector("li code")?.textContent).toBe("replay");
	expect(host.querySelector("pre code")?.textContent).toContain(
		"const value = 1;",
	);
	const end =
		"\n```\n\n| Topic | Value |\n| --- | --- |\n| CQRS | Useful |\n\n[Docs](https://example.com)\n\n<script>window.bad=true</script>\n\n[Unsafe](javascript:alert(1))";
	await act(async () => delta({ id, text: end }));
	await act(async () =>
		finish({ status: "complete", text: first + rest + end }),
	);
	expect(host.querySelector("table td")?.textContent).toBe("CQRS");
	expect(
		host.querySelector("table > span, thead > span, tbody > span, tr > span"),
	).toBeNull();
	expect(host.querySelector('a[href="https://example.com"]')?.textContent).toBe(
		"Docs",
	);
	await act(async () =>
		host
			.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')
			?.click(),
	);
	expect(mocks.api.openExternalUrl).toHaveBeenCalledWith("https://example.com");
	expect(host.querySelector("script")).toBeNull();
	expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
});

it("interweaves streamed text and workspace operations and restores their order", async () => {
	await sendMessage();
	const { id } = mocks.api.chatSend.mock.calls[0][0];
	const message = (id: string, text: string) => ({
		type: "message",
		id,
		role: "assistant",
		content: [{ type: "output_text", text }],
	});
	const operation = (id: string, name: string) => [
		{
			type: "function_call",
			call_id: id,
			name,
			namespace: "workspace",
			arguments: "{}",
		},
		{
			type: "function_call_output",
			call_id: id,
			output: JSON.stringify({ path: "note.md" }),
		},
	];
	const context = [
		message("m0", "First thought"),
		message("m1", "More detail"),
		...operation("read", "read_file"),
	];
	await act(async () => delta({ id, text: "First thoughtMore detail" }));
	await act(async () => delta({ id, text: "", context }));
	await act(async () => delta({ id, text: "\n\nSecond thought" }));
	const reply = () => {
		const articles = host.querySelectorAll("article");
		const article = articles[articles.length - 1];
		if (!article) throw new Error("Expected an assistant reply");
		return article;
	};
	expect(reply().textContent?.indexOf("Read note.md")).toBeLessThan(
		reply().textContent?.indexOf("Second thought") ?? 0,
	);
	const completed = [
		...context,
		message("m2", "Second thought"),
		...operation("write", "apply_patch"),
		message("m3", "Done"),
	];
	await act(async () =>
		finish({
			status: "complete",
			text: "First thoughtMore detail\n\nSecond thought\n\nDone",
			context: completed,
		}),
	);
	const assertOrder = () => {
		const text = reply().textContent ?? "";
		const positions = [
			"First thought",
			"Read note.md",
			"Second thought",
			"Edited note.md",
			"Done",
		].map((label) => text.indexOf(label));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	};
	assertOrder();
	const saved = JSON.stringify(serialize(appStore.get()));
	localStorage.setItem(STORAGE_KEY, saved);
	await act(async () => appStore.set(getInitialState()));
	assertOrder();
});

it("fades only appended text while preserving streaming Markdown", async () => {
	await sendMessage();
	const { id } = mocks.api.chatSend.mock.calls[0][0];
	await act(async () => delta({ id, text: "First chunk " }));
	const first = host.querySelector(".chat-markdown [data-stream-chunk]");
	expect(first?.textContent?.trim()).toBe("First chunk");
	await act(async () => delta({ id, text: "and **bold" }));
	expect(host.querySelector(".chat-markdown [data-stream-chunk]")).toBe(first);
	expect(first?.classList.contains("chat-chunk-enter")).toBe(false);
	await act(async () => delta({ id, text: " text**" }));
	expect(host.querySelector("strong")?.textContent).toBe("bold text");
	expect(host.querySelectorAll(".chat-chunk-enter").length).toBeGreaterThan(0);
	await act(async () =>
		finish({ status: "complete", text: "First chunk and **bold text**" }),
	);
	expect(host.querySelector(".chat-chunk-enter")).toBeNull();
	expect(host.querySelector("strong")?.textContent).toBe("bold text");
});
