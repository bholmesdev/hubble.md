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
	const { account, busy, signingIn, error, disconnectPending } =
		useStoreValue(chatConnection);
	function report(error: unknown) {
		chatConnection.set({ ...chatConnection.get(), error: errorText(error) });
	}
	function openUsage() {
		void desktopApi
			.openExternalUrl("https://chatgpt.com/settings/usage")
			.catch(report);
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
				) : !account?.connected || !account.sharing ? (
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
							: account?.connected
								? "Enable access"
								: "Sign in with ChatGPT"}
					</Button>
				) : null}
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
				{account?.connected ? (
					<Button variant="ghost" size="sm" onClick={openUsage}>
						Manage usage
					</Button>
				) : null}
			</div>
			{!busy && account?.connected && !account.sharing ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					Hubble doesn’t have permission to use your ChatGPT plan.
				</p>
			) : null}
			{error ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{error}
				</p>
			) : null}
			{disconnectPending ? (
				<Button variant="ghost" size="sm" onClick={openUsage}>
					Open ChatGPT settings
				</Button>
			) : null}
			{!busy && !error && account?.issue === "refresh-unavailable" ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					Something went wrong. Please try again.
				</p>
			) : null}
		</SettingsSection>
	);
}
