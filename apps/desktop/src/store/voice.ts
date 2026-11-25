import { store } from "@simplestack/store";
import { desktopApi } from "../desktopApi";
import { CHAT_TEXT_LIMIT } from "../desktopApi/chat";
import { editChatDraft } from "../desktopApi/chatTranscript";
import type { VoiceEvent } from "../desktopApi/voice";
import { errorText } from "./chatConnection";
import { workspacePathStore } from "./state";
import { updateTabChat } from "./tabChat";
import { tabsStore } from "./tabStore";
import type { TabId } from "./tabs";

export const voice = store<
	(VoiceEvent & { tabId: TabId; workspace: string | undefined }) | null
>(null);
export const voiceLevel = store(0);
export function isRecording() {
	const status = voice.get()?.status;
	return (
		status === "starting" || status === "listening" || status === "stopping"
	);
}
let unsubscribe: (() => void) | undefined;
export async function startVoice(tabId: TabId) {
	if (isRecording()) return;
	const tab = tabsStore.get().byId[tabId];
	if (!tab) return;
	const id = crypto.randomUUID();
	const workspace = workspacePathStore.get();
	const base = tab.chat?.draft ?? "";
	voiceLevel.set(0);
	voice.set({ id, tabId, workspace, status: "starting" });
	unsubscribe?.();
	unsubscribe = desktopApi.onVoice((event) => {
		const current = voice.get();
		if (current?.id !== event.id || !isRecording()) return;
		// Meter ticks must not replace transcript state or rerender the whole panel.
		if (event.level !== undefined) {
			voiceLevel.set(current.status === "listening" ? event.level : 0);
			if (event.text === undefined && event.error === undefined) return;
		}
		if (event.status !== "listening") voiceLevel.set(0);
		// Native partial results can arrive after Stop while the last words settle.
		const status =
			current.status === "stopping" && event.status === "listening"
				? "stopping"
				: event.status;
		voice.set({ ...event, status, tabId, workspace });
		if (event.text !== undefined && workspacePathStore.get() === workspace) {
			const draft = [base, event.text].filter(Boolean).join("\n");
			updateTabChat(tabId, (chat) =>
				editChatDraft(chat, draft.slice(0, CHAT_TEXT_LIMIT)),
			);
			if (draft.length > CHAT_TEXT_LIMIT) stopVoice();
		}
	});
	try {
		await desktopApi.voiceStart(id);
	} catch (error) {
		if (voice.get()?.id === id)
			voice.set({
				id,
				tabId,
				workspace,
				status: "error",
				error: errorText(error),
			});
	}
}
export function stopVoice() {
	const current = voice.get();
	if (!current || !isRecording() || current.status === "stopping") return;
	voiceLevel.set(0);
	voice.set({ ...current, status: "stopping" });
	void desktopApi.voiceStop(current.id).catch((error) => {
		if (voice.get()?.id === current.id)
			voice.set({ ...current, status: "error", error: errorText(error) });
	});
}
