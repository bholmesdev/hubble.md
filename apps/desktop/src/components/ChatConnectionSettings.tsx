import { Button } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { useEffect } from "react";
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
	const { account, models, busy, signingIn, sending, error } =
		useStoreValue(chatConnection);
	useEffect(() => {
		void refreshChatConnection();
	}, []);
	function report(error: unknown) {
		chatConnection.set({ ...chatConnection.get(), error: errorText(error) });
	}
	return (
		<SettingsSection
			title="Chat"
			description="Connect your ChatGPT plan to use the chat panel."
		>
			{account?.label ? (
				<p className="mb-2 break-all text-xs text-muted-foreground">
					{account.label}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				{account?.issue === "unreadable-credentials" ? (
					<Button
						variant="outline"
						size="sm"
						disabled={busy || sending}
						onClick={() => void resetChatConnection()}
					>
						Reset connection and sign in again
					</Button>
				) : signingIn ? (
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
						disabled={busy || sending}
						onClick={() => void refreshChatConnection(true)}
					>
						{account?.connected ? "Reconnect" : "Continue with ChatGPT"}
					</Button>
				)}
				{account?.label ? (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy || sending}
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
			{sending ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Stop the current reply before changing your connection.
				</p>
			) : null}
			{!busy && account?.connected && (!account.sharing || !models.length) ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Enable plan usage in Manage usage, then reconnect.
				</p>
			) : null}
			{account?.issue === "unreadable-credentials" && !error ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					Your saved sign-in could not be opened. Reset the connection and sign
					in again. Your notes and chats will stay here.
				</p>
			) : null}
			{error ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{error}
				</p>
			) : null}
		</SettingsSection>
	);
}
