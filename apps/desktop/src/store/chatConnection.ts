import { store } from "@simplestack/store";
import { desktopApi } from "../desktopApi";
import type { ChatAccount, ChatModel } from "../desktopApi/chat";
import { clearChats } from "./tabChat";

export const chatConnection = store({
	account: null as ChatAccount | null,
	models: [] as ChatModel[],
	busy: false,
	signingIn: false,
	sending: false,
	revision: 0,
	error: null as string | null,
});

export function errorText(error: unknown) {
	return error instanceof Error
		? error.message.replace(
				/^Error invoking remote method '[^']+': (?:Error: )?/,
				"",
			)
		: "ChatGPT is unavailable. Try again.";
}

// Keep exception handling outside component handlers for React Compiler.
export async function attempt<T>(
	action: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	try {
		return { ok: true, value: await action() };
	} catch (error) {
		return { ok: false, error: errorText(error) };
	}
}

export async function refreshChatConnection(signIn = false) {
	if (chatConnection.get().busy || chatConnection.get().sending) return;
	chatConnection.set({
		...chatConnection.get(),
		busy: true,
		signingIn: signIn,
		error: null,
	});
	const result = await attempt(async () => {
		const account = await (signIn
			? desktopApi.chatSignIn()
			: desktopApi.chatAccount());
		const catalog = await attempt(() =>
			account.sharing ? desktopApi.chatModels() : Promise.resolve([]),
		);
		return {
			account,
			models: catalog.ok ? catalog.value : [],
			error: catalog.ok ? null : catalog.error,
		};
	});
	chatConnection.set({
		...chatConnection.get(),
		...(result.ok
			? result.value
			: { account: null, models: [], error: result.error }),
		busy: false,
		signingIn: false,
	});
}

export async function disconnectChat() {
	if (chatConnection.get().busy || chatConnection.get().sending) return;
	chatConnection.set({ ...chatConnection.get(), busy: true, error: null });
	const result = await attempt(() => desktopApi.chatDisconnect());
	clearChats();
	chatConnection.set({
		...chatConnection.get(),
		account: null,
		models: [],
		busy: false,
		revision: chatConnection.get().revision + 1,
		error: result.ok ? null : result.error,
	});
}

export async function resetChatConnection() {
	if (chatConnection.get().busy || chatConnection.get().sending) return;
	chatConnection.set({ ...chatConnection.get(), busy: true, error: null });
	const result = await attempt(() => desktopApi.chatReset());
	chatConnection.set({
		...chatConnection.get(),
		busy: false,
		error: result.ok ? null : result.error,
	});
	if (result.ok) {
		chatConnection.set({ ...chatConnection.get(), account: null, models: [] });
		await refreshChatConnection(true);
	}
}
