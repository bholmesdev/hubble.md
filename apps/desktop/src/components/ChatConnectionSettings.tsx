import { Button } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { desktopApi } from "../desktopApi";
import {
	chatConnection,
	disconnectChat,
	errorText,
	refreshChatConnection,
	resetChatConnection,
} from "../store/chatConnection";
import { SettingsSection } from "./SettingsDialog";

export function ChatConnectionSettings() {
	const { account, busy, signingIn, error } = useStoreValue(chatConnection);
	function report(error: unknown) {
		chatConnection.set({ ...chatConnection.get(), error: errorText(error) });
	}
	return (
		<SettingsSection title="Chat" description="Connect your ChatGPT account.">
			{account?.label && account.expiresAt ? (
				<p className="mb-2 break-all text-xs text-muted-foreground">
					{account.label}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				{signingIn ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() => void desktopApi.chatCancelSignIn().catch(report)}
					>
						Cancel sign-in
					</Button>
				) : (
					<Button
						data-oai-siwc-button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() =>
							void (account?.issue === "unreadable-credentials"
								? resetChatConnection()
								: refreshChatConnection(
										account?.issue !== "refresh-unavailable",
									))
						}
					>
						{account?.issue === "refresh-unavailable"
							? "Try again"
							: account?.expiresAt
								? "Reconnect"
								: "Sign in with ChatGPT"}
					</Button>
				)}
				{account?.label && account.expiresAt ? (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => void disconnectChat()}
					>
						Sign out
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						void desktopApi
							.openExternalUrl("https://chatgpt.com/settings/usage")
							.catch(report)
					}
				>
					Manage usage
				</Button>
			</div>
			{!busy && account?.connected && !account.sharing ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					Enable plan usage in “Manage usage”, then reconnect.
				</p>
			) : null}
			{error ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{error}
				</p>
			) : null}
			{!busy && !error && account?.issue === "refresh-unavailable" ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					Something went wrong. Please try again.
				</p>
			) : null}
		</SettingsSection>
	);
}
