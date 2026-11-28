import { store } from "@simplestack/store";
import { desktopApi } from "../desktopApi";
import type { ChatAccount } from "../desktopApi/chat";

export const chatConnection = store({
	account: null as ChatAccount | null,
	busy: false,
	signingIn: false,
	error: null as string | null,
	disconnectPending: false,
});

export const DISCONNECT_WARNING =
	"You’re signed out of Hubble. Finish disconnecting in ChatGPT settings.";

export function errorText(error: unknown) {
	if (error instanceof Error && error.message.includes("Signed out locally."))
		return DISCONNECT_WARNING;
	return "Something went wrong. Please try again.";
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
	if (chatConnection.get().busy) return;
	await loadConnection(signIn);
}

async function loadConnection(signIn: boolean) {
	chatConnection.set({
		...chatConnection.get(),
		busy: true,
		signingIn: signIn || chatConnection.get().signingIn,
		error: null,
	});
	const result = await attempt(() =>
		signIn ? desktopApi.chatSignIn() : desktopApi.chatAccount(),
	);
	let account = result.ok ? result.value : null;
	if (!result.ok && signIn) {
		const saved = await attempt(() => desktopApi.chatAccount());
		account = saved.ok ? saved.value : null;
	}
	chatConnection.set({
		account,
		disconnectPending:
			signIn && result.ok ? false : chatConnection.get().disconnectPending,
		busy: !!account?.busy,
		signingIn: !!account?.signingIn,
		// A missing-permission message already explains why enabling access did not succeed.
		error:
			result.ok || (signIn && account?.connected && !account.sharing)
				? null
				: signIn
					? "Sign-in failed. Please try again."
					: result.error,
	});
	// The main process owns browser sign-in and may outlive a renderer reload.
	if (account?.busy) window.setTimeout(() => void loadConnection(false), 1000);
}

export async function disconnectChat() {
	if (chatConnection.get().busy) return;
	chatConnection.set({ ...chatConnection.get(), busy: true, error: null });
	const result = await attempt(() => desktopApi.chatDisconnect());
	// Remote revocation may fail after local credentials have already been removed.
	const account = await attempt(() => desktopApi.chatAccount());
	chatConnection.set({
		account: account.ok ? account.value : null,
		disconnectPending: !result.ok && result.error === DISCONNECT_WARNING,
		busy: false,
		signingIn: false,
		error: result.ok ? (account.ok ? null : account.error) : result.error,
	});
}

export async function resetChatConnection() {
	if (chatConnection.get().busy) return;
	chatConnection.set({ ...chatConnection.get(), busy: true, error: null });
	const result = await attempt(() => desktopApi.chatReset());
	chatConnection.set({
		...chatConnection.get(),
		busy: false,
		error: result.ok ? null : result.error,
	});
	if (result.ok) {
		chatConnection.set({ ...chatConnection.get(), account: null });
		await refreshChatConnection(true);
	}
}
