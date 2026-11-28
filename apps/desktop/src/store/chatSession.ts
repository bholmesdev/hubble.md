import { store } from "@simplestack/store";
import { desktopApi } from "../desktopApi";
import { type ChatMessage, chatFile } from "../desktopApi/chat";
import { isEditableFile } from "../lib/filePath";
import { isVirtualPath } from "../lib/newTabPage";
import { attempt, chatConnection } from "./chatConnection";
import { handleChatFileRequest } from "./chatFiles";
import { appStore, viewerStore, workspacePathStore } from "./state";
import { chatPanelOpen, EMPTY_CHAT, updateTabChat } from "./tabChat";
import { tabsStore } from "./tabStore";

export const chatSession = store({
	request: null as {
		id: string;
		tabId: string;
		workspace: string | undefined;
		revision: number;
	} | null,
	activity: "Thinking",
	error: null as string | null,
	checking: false,
});

export function initializeChatSession() {
	const unsubscribe = desktopApi.onChatDelta(
		({ id, text, context, activity }) => {
			const request = chatSession.get().request;
			if (!request || request.id !== id || !isCurrent(request)) return;
			if (activity) chatSession.set({ ...chatSession.get(), activity });
			updateTabChat(request.tabId, (chat) => ({
				...chat,
				messages: chat.messages.map((message) =>
					message.id === id
						? {
								...message,
								text: message.text + text,
								...(context ? { context } : {}),
							}
						: message,
				),
			}));
		},
	);
	const files = desktopApi.onChatFileRequest((request) => {
		if (chatSession.get().request?.id !== request.requestId) return;
		void handleChatFileRequest(
			request,
			() => {
				const current = chatSession.get().request;
				return (
					!!current && current.id === request.requestId && isCurrent(current)
				);
			},
			chatSession.get().request?.tabId,
		)
			.then((reply) => desktopApi.chatFileReply(reply))
			.catch(() => {
				stopChat();
				chatSession.set({
					...chatSession.get(),
					error: "Something went wrong. Please try again.",
				});
			});
	});
	const state = appStore.subscribe(() => {
		const request = chatSession.get().request;
		if (request && !isCurrent(request)) stopChat();
	});
	return () => {
		unsubscribe();
		files();
		state();
		stopChat();
	};
}

function isCurrent(
	request: NonNullable<ReturnType<typeof chatSession.get>["request"]>,
) {
	return (
		tabsStore.get().activeTabId === request.tabId &&
		!!tabsStore.get().byId[request.tabId] &&
		workspacePathStore.get() === request.workspace &&
		chatConnection.get().revision === request.revision &&
		chatPanelOpen.get()
	);
}

export function stopChat() {
	const request = chatSession.get().request;
	if (!request) return;
	// Stop accepting editor operations immediately, before the IPC round trip finishes.
	chatSession.set({ ...chatSession.get(), request: null });
	updateTabChat(request.tabId, (chat) => ({
		...chat,
		messages: chat.messages.map((message) =>
			message.id === request.id
				? { ...message, status: "stopped", finishedAt: Date.now() }
				: message,
		),
	}));
	void desktopApi.chatStop(request.id).catch(() => {});
}

export async function sendChat(tabId: string, model: string) {
	const connection = chatConnection.get();
	const tabs = tabsStore.get();
	const chat = tabs.byId[tabId]?.chat ?? EMPTY_CHAT;
	const doc = viewerStore.get();
	const workspace = workspacePathStore.get();
	if (
		chatSession.get().checking ||
		connection.sending ||
		connection.busy ||
		!connection.account?.sharing ||
		!connection.account.connected ||
		tabs.activeTabId !== tabId ||
		!chat.draft.trim() ||
		!model
	)
		return;
	const path = tabs.byId[tabId]?.path;
	const editable = path && !isVirtualPath(path) && isEditableFile(path);
	if (editable && (doc.currentPath !== path || doc.status !== "ready")) return;
	const file = editable
		? chatFile(
				chat.messages,
				workspace && path.startsWith(`${workspace}/`)
					? path.slice(workspace.length + 1)
					: path,
				doc.content,
			)
		: null;
	const user: ChatMessage = {
		id: crypto.randomUUID(),
		role: "user",
		text: chat.draft.trim(),
		file,
		status: "complete",
	};
	const history = [...chat.messages, user];
	chatSession.set({ ...chatSession.get(), checking: true, error: null });
	const budget = await attempt(() => desktopApi.chatCheckBudget(history));
	chatSession.set({ ...chatSession.get(), checking: false });
	// Counting runs in a worker. Keep a changed draft, file, tab, or account intact.
	if (
		tabsStore.get().activeTabId !== tabId ||
		(tabsStore.get().byId[tabId]?.chat ?? EMPTY_CHAT) !== chat ||
		workspacePathStore.get() !== workspace ||
		viewerStore.get() !== doc ||
		chatConnection.get() !== connection ||
		!chatPanelOpen.get()
	)
		return;
	if (!budget.ok || !budget.value || history.length > 99) {
		chatSession.set({
			...chatSession.get(),
			error: budget.ok ? "Chat is too long. Start a new chat." : budget.error,
		});
		return;
	}
	const id = crypto.randomUUID();
	const request = { id, tabId, workspace, revision: connection.revision };
	chatSession.set({
		request,
		activity: "Thinking",
		error: null,
		checking: false,
	});
	chatConnection.set({ ...connection, sending: true });
	updateTabChat(tabId, (current) => ({
		...current,
		model,
		draft: "",
		messages: [
			...history,
			{
				id,
				role: "assistant",
				text: "",
				status: "streaming",
				startedAt: Date.now(),
			},
		],
	}));
	const result = await attempt(() =>
		desktopApi.chatSend({ id, model, messages: history }),
	);
	// A stopped request can still contain completed tool edits. Retain its balanced
	// calls/results in the original conversation, even after switching tabs.
	if (
		workspacePathStore.get() === workspace &&
		chatConnection.get().revision === request.revision
	) {
		updateTabChat(tabId, (current) => ({
			...current,
			messages: current.messages.map((message) =>
				message.id === id
					? {
							...message,
							...(result.ok ? result.value : { status: "failed" as const }),
							finishedAt: Date.now(),
						}
					: message,
			),
		}));
		if (chatSession.get().request?.id === id)
			chatSession.set({
				...chatSession.get(),
				request: null,
				error: result.ok ? (result.value.error ?? null) : result.error,
			});
	}
	chatConnection.set({ ...chatConnection.get(), sending: false });
}
