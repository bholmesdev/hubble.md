import type { chatConnection } from "./chatConnection";

type Connection = ReturnType<typeof chatConnection.get>;
export type ConnectionAction = "cancel" | "reset" | "retry" | "sign-in";

/** Both settings and Chat use the same recovery decisions and user-facing copy. */
export function getChatConnectionState(connection: Connection) {
	const { account, busy, signingIn, error, disconnectPending } = connection;
	const needsAccess = !!account?.connected && !account.sharing;
	const retry = account?.issue === "refresh-unavailable";
	const kind = signingIn
		? "signing-in"
		: needsAccess
			? "needs-access"
			: retry
				? "retry"
				: account?.connected
					? "connected"
					: "signed-out";
	const primary: { action: ConnectionAction; label: string } | null = signingIn
		? { action: "cancel", label: "Cancel sign-in" }
		: !account?.connected || needsAccess
			? {
					action:
						account?.issue === "unreadable-credentials"
							? "reset"
							: retry
								? "retry"
								: "sign-in",
					label: retry
						? "Try again"
						: needsAccess
							? "Enable access"
							: "Sign in with ChatGPT",
				}
			: null;
	return {
		kind,
		primary,
		ready: kind === "connected",
		disabled: busy && !signingIn,
		showAccount: !!account?.label && !!account.expiresAt,
		showUsage: !!account?.connected,
		disconnectPending,
		message:
			!busy && needsAccess
				? "Hubble doesn’t have permission to use your ChatGPT plan."
				: (error ??
					(!busy && retry ? "Something went wrong. Please try again." : null)),
	};
}
