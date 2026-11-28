import { Button } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import openaiBlack from "../assets/openai-blossom-black.svg";
import openaiWhite from "../assets/openai-blossom-white.svg";
import { desktopApi } from "../desktopApi";
import {
	chatConnection,
	disconnectChat,
	errorText,
	refreshChatConnection,
	resetChatConnection,
} from "../store/chatConnection";
import {
	type ConnectionAction,
	getChatConnectionState,
} from "../store/chatConnectionState";

export function ChatConnectionControls({
	variant = "settings",
}: {
	variant?: "settings" | "panel";
}) {
	const connection = useStoreValue(chatConnection);
	const state = getChatConnectionState(connection);
	const primary = state.primary;
	const panel = variant === "panel";
	function report(error: unknown) {
		chatConnection.set({ ...chatConnection.get(), error: errorText(error) });
	}
	function run(action: ConnectionAction) {
		if (action === "cancel") void desktopApi.chatCancelSignIn().catch(report);
		else if (action === "reset") void resetChatConnection();
		else void refreshChatConnection(action === "sign-in");
	}
	function openUsage() {
		void desktopApi
			.openExternalUrl("https://chatgpt.com/settings/usage")
			.catch(report);
	}
	return (
		<>
			{!panel && state.showAccount ? (
				<p className="mb-2 break-all text-xs text-muted-foreground">
					{connection.account?.label}
				</p>
			) : null}
			<div
				className={
					panel ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"
				}
			>
				{primary ? (
					<Button
						data-oai-siwc-button
						variant="outline"
						size={panel ? "default" : "sm"}
						disabled={state.disabled}
						className={
							panel
								? "h-auto min-h-10 w-full justify-center gap-2.5 px-3 py-2 text-sm font-normal"
								: undefined
						}
						onClick={() => run(primary.action)}
					>
						{panel && primary.label === "Sign in with ChatGPT" ? (
							<>
								<img src={openaiBlack} alt="" className="size-5 dark:hidden" />
								<img
									src={openaiWhite}
									alt=""
									className="hidden size-5 dark:block"
								/>
							</>
						) : null}
						{primary.label}
					</Button>
				) : null}
				{!panel && state.showAccount ? (
					<Button
						variant="ghost"
						size="sm"
						disabled={connection.busy}
						onClick={() => void disconnectChat()}
					>
						Sign out
					</Button>
				) : null}
				{!panel && state.showUsage ? (
					<Button variant="ghost" size="sm" onClick={openUsage}>
						Manage usage
					</Button>
				) : null}
			</div>
			{state.message ? (
				<p
					role="alert"
					className={`${panel ? "" : "mt-2 "}text-xs text-destructive`}
				>
					{state.message}
				</p>
			) : null}
			{state.disconnectPending ? (
				<Button variant="ghost" size="sm" onClick={openUsage}>
					Open ChatGPT settings
				</Button>
			) : null}
		</>
	);
}
