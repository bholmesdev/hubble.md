import { store } from "@simplestack/store";
import type { ChatConversation } from "../desktopApi/chat";
import { appStore } from "./state";
import { tabsStore } from "./tabStore";
import type { TabId } from "./tabs";

export const chatPanelOpen = store(false);
export const EMPTY_CHAT: ChatConversation = {
	messages: [],
	draft: "",
	model: "",
};

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
