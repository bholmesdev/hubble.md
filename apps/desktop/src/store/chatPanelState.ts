import type { chatConnection } from "./chatConnection";

type Connection = ReturnType<typeof chatConnection.get>;
export type ChatPanelState =
	| { kind: "checking" }
	| { kind: "signed-out" | "signing-in" }
	| { kind: "reset-required"; message: string }
	| { kind: "connection-error" | "setup-required"; message: string }
	| {
			kind: "conversation";
			conversation: "new" | "existing";
			composer: "ready" | "sending" | "file-loading" | "file-error";
			reason?: string;
	  };

/** Authentication gates saved history; a transcript never makes a disconnected account ready. */
export function getChatPanelState(
	connection: Connection,
	file: { ready: boolean; error: string | null },
	hasMessages: boolean,
): ChatPanelState {
	if (connection.signingIn) return { kind: "signing-in" };
	if (connection.busy && !connection.sending) return { kind: "checking" };
	if (connection.account?.issue === "unreadable-credentials")
		return {
			kind: "reset-required",
			message:
				connection.error ??
				"Your saved ChatGPT sign-in could not be opened. Reset the connection and sign in again. Your notes and chats will stay here.",
		};
	if (!connection.account && connection.error)
		return { kind: "connection-error", message: connection.error };
	if (!connection.account?.connected) return { kind: "signed-out" };
	if (connection.error)
		return { kind: "connection-error", message: connection.error };
	if (!connection.account.sharing)
		return {
			kind: "setup-required",
			message: "Enable ChatGPT plan usage in Chat settings, then reconnect.",
		};
	if (!connection.models.length)
		return {
			kind: "setup-required",
			message:
				"No chat models are available for this account. Retry the connection or open Chat settings.",
		};
	return {
		kind: "conversation",
		conversation: hasMessages ? "existing" : "new",
		composer: connection.sending
			? "sending"
			: file.ready
				? "ready"
				: file.error
					? "file-error"
					: "file-loading",
		...(!file.ready
			? { reason: file.error ?? "Loading the current file…" }
			: {}),
	};
}
