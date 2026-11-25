import { store } from "@simplestack/store";
import {
	CHAT_TEXT_LIMIT,
	type ChatAttachment,
	type ChatConversation,
	chatAttachmentSchema,
} from "../desktopApi/chat";
import { isNewTabPath } from "../lib/newTabPage";
import { chatConnection } from "./chatConnection";
import { appStore, uiStore } from "./state";
import { tabsStore } from "./tabStore";
import type { TabId } from "./tabs";

export const chatSelection = store<(ChatAttachment & { tabId: TabId }) | null>(
	null,
);

export const chatPanelOpen = uiStore.select("chatPanelOpen");
export const chatPanelWidth = store(360);

export const EMPTY_CHAT: ChatConversation = {
	messages: [],
	draft: "",
	model: "",
};

export function toggleChatPanel() {
	const tabs = tabsStore.get();
	const path = tabs.byId[tabs.activeTabId ?? ""]?.path;
	if (path && !isNewTabPath(path)) chatPanelOpen.set(!chatPanelOpen.get());
}

export function updateTabChat(
	id: TabId,
	update: (chat: ChatConversation) => ChatConversation,
) {
	tabsStore.set((tabs) => {
		const tab = tabs.byId[id];
		// Late stream output must not recreate a closed tab or cross workspace boundaries.
		if (!tab) return tabs;
		return {
			...tabs,
			byId: {
				...tabs.byId,
				[id]: { ...tab, chat: update(tab.chat ?? EMPTY_CHAT) },
			},
		};
	});
}

export function clearChats() {
	appStore.set((state) => ({
		...state,
		tabs: {
			...state.tabs,
			byId: Object.fromEntries(
				Object.entries(state.tabs.byId).map(([id, { chat: _chat, ...tab }]) => [
					id,
					tab,
				]),
			),
		},
		tabSessions: Object.fromEntries(
			Object.entries(state.tabSessions).map(([workspace, session]) => [
				workspace,
				{ ...session, chats: {} },
			]),
		),
	}));
}

export function attachToChat(
	input: Omit<ChatAttachment, "id">,
	repeat = false,
) {
	if (!chatConnection.get().account?.connected) {
		chatPanelOpen.set(true);
		return false;
	}
	const id = tabsStore.get().activeTabId;
	const inline = input.kind === "selection";
	const attachment = chatAttachmentSchema.safeParse({
		...input,
		...(inline
			? { offset: tabsStore.get().byId[id ?? ""]?.chat?.draft.length ?? 0 }
			: {}),
		id: crypto.randomUUID(),
	});
	if (!id || !attachment.success) return false;
	const pending = tabsStore.get().byId[id].chat?.attachments ?? [];
	const match =
		!repeat &&
		pending.find(
			(item) =>
				item.kind === input.kind &&
				item.path === input.path &&
				(input.kind === "thread"
					? item.threadId === input.threadId
					: item.text === input.text),
		);
	if (!match && pending.length >= 20) return false;
	const next = match
		? pending.map((item) =>
				item.id === match.id
					? { ...attachment.data, id: match.id, offset: match.offset }
					: item,
			)
		: [...pending, attachment.data];
	if (JSON.stringify(next).length > CHAT_TEXT_LIMIT) return false;
	updateTabChat(id, (chat) => ({ ...chat, attachments: next }));
	chatPanelOpen.set(true);
	return true;
}
