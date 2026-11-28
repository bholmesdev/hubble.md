import { Button, useCommandShortcutLabel } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { useEffect, useRef, useState } from "react";
import MingcuteEditLine from "~icons/mingcute/edit-line";
import MingcuteSidebarRightLine from "~icons/mingcute/sidebar-right-line";
import openaiBlack from "../assets/openai-blossom-black.svg";
import openaiWhite from "../assets/openai-blossom-white.svg";
import { desktopApi } from "../desktopApi";
import { isEditableFile } from "../lib/filePath";
import { isVirtualPath } from "../lib/newTabPage";
import { resolveRelativeLinkPath } from "../lib/relativeLinkPath";
import { windowControlsInset } from "../lib/windowChrome";
import { loadPath, setTerminalOpen } from "../store/actions";
import {
	attempt,
	chatConnection,
	refreshChatConnection,
	resetChatConnection,
} from "../store/chatConnection";
import { chatSession, sendChat, stopChat } from "../store/chatSession";
import { viewerStore, workspacePathStore } from "../store/state";
import { chatPanelOpen, EMPTY_CHAT, updateTabChat } from "../store/tabChat";
import { tabsStore } from "../store/tabStore";
import { ChatComposer } from "./ChatComposer";
import { ChatMark } from "./ChatMark";
import { ChatModelPicker } from "./ChatModelPicker";
import { ChatReply } from "./ChatReply";
import { SendArrow } from "./SendArrow";

export function ChatPanel({
	onOpenSettings,
	fullHeight,
}: {
	onOpenSettings: () => void;
	fullHeight: boolean;
}) {
	const open = useStoreValue(chatPanelOpen);
	const tabs = useStoreValue(tabsStore);
	const tabId = tabs.activeTabId;
	const tab = tabs.byId[tabId ?? ""];
	const chat = tab?.chat ?? EMPTY_CHAT;
	const connection = useStoreValue(chatConnection);
	const session = useStoreValue(chatSession);
	const doc = useStoreValue(viewerStore);
	const workspace = useStoreValue(workspacePathStore);
	const transcript = useRef<HTMLDivElement>(null);
	const [scrolled, setScrolled] = useState(false);
	const closeTitle = useCommandShortcutLabel("Close Chat", "app.toggle-chat");
	useEffect(() => {
		if (open && chat.messages.length)
			transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
	}, [open, chat.messages]);
	if (!open || !tabId || !tab?.path) return null;
	const { account, busy, signingIn, models, error } = connection;
	const ready = account?.connected && account.sharing;
	const fileReady =
		isVirtualPath(tab.path) ||
		!isEditableFile(tab.path) ||
		(doc.currentPath === tab.path && doc.status === "ready");
	const model = models.some((item) => item.slug === chat.model)
		? chat.model
		: (models[0]?.slug ?? "");
	const send = () => void sendChat(tabId, model);
	function openLink(href: string) {
		void attempt(async () => {
			if (/^https?:|^mailto:/i.test(href)) {
				await desktopApi.openExternalUrl(href);
				return;
			}
			if (!workspace || href.startsWith("#")) return;
			const path = resolveRelativeLinkPath({
				href: decodeURIComponent(href),
				currentFilePath: `${workspace}/chat.md`,
				workspacePath: workspace,
			});
			const result = await desktopApi.openPathFromLink(path);
			if (result.kind === "file") await loadPath(result.path);
		});
	}
	return (
		<aside
			id="chat-sidebar"
			aria-label="Chat"
			className={`col-start-2 flex h-full min-h-0 w-[360px] max-w-[85vw] shrink-0 flex-col border-s border-border bg-background text-sm ${fullHeight ? "row-start-1 row-span-2" : "row-start-2"}`}
		>
			<header
				style={
					fullHeight
						? {
								paddingInlineEnd: `max(8px, ${windowControlsInset(desktopApi.platform)})`,
							}
						: undefined
				}
				className={`relative flex h-9 shrink-0 items-center justify-between px-2 [&_button]:[-webkit-app-region:no-drag] ${fullHeight ? "[-webkit-app-region:drag]" : ""} after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-dashed ${scrolled ? "after:border-border" : "after:border-transparent"}`}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="New chat"
					title="New chat"
					disabled={!ready || connection.sending}
					onClick={() => {
						updateTabChat(tabId, () => ({ ...EMPTY_CHAT, model }));
						chatSession.set({ ...chatSession.get(), error: null });
					}}
				>
					<MingcuteEditLine className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close Chat"
					title={closeTitle}
					aria-expanded={true}
					aria-controls="chat-sidebar"
					className="bg-muted text-foreground"
					onClick={() => chatPanelOpen.set(false)}
				>
					<MingcuteSidebarRightLine className="size-4" />
				</Button>
			</header>
			{!ready ? (
				<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
					<div className="flex w-full max-w-[250px] flex-col gap-3">
						<ChatMark />
						<h2 className="text-center text-lg font-semibold">
							Chat with your notes
						</h2>
						<p className="mb-3 text-center text-xs leading-relaxed text-muted-foreground">
							Work with your agents to draft notes, leave comments, and connect
							ideas across files
						</p>
						<Button
							variant="outline"
							data-oai-siwc-button
							disabled={busy && !signingIn}
							className="h-auto min-h-10 justify-center gap-2.5 px-3 py-2 text-sm font-normal"
							onClick={() => {
								if (signingIn) void desktopApi.chatCancelSignIn();
								else if (account?.issue === "unreadable-credentials")
									void resetChatConnection();
								else
									void refreshChatConnection(
										account?.issue !== "refresh-unavailable",
									);
							}}
						>
							{!signingIn &&
							!account?.connected &&
							account?.issue !== "refresh-unavailable" ? (
								<>
									<img
										src={openaiBlack}
										alt=""
										className="size-5 dark:hidden"
									/>
									<img
										src={openaiWhite}
										alt=""
										className="hidden size-5 dark:block"
									/>
								</>
							) : null}
							{signingIn
								? "Cancel sign-in"
								: account?.issue === "refresh-unavailable"
									? "Try again"
									: account?.connected
										? "Enable access"
										: "Sign in with ChatGPT"}
						</Button>
						<Button
							variant="ghost"
							className="h-auto self-center px-0 py-1 text-sm font-normal hover:bg-transparent"
							onClick={() => {
								setTerminalOpen(true);
								chatPanelOpen.set(false);
							}}
						>
							Use the terminal
						</Button>
						{account?.connected && !account.sharing ? (
							<p role="alert" className="text-xs text-destructive">
								Hubble doesn’t have permission to use your ChatGPT plan.
							</p>
						) : error ? (
							<p role="alert" className="text-xs text-destructive">
								{error}
							</p>
						) : null}
					</div>
				</div>
			) : (
				<>
					<div
						ref={transcript}
						onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
						role="log"
						aria-label="Chat messages"
						aria-live="off"
						className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4"
					>
						{chat.messages.map((message) => (
							<article
								key={message.id}
								aria-label={
									message.role === "user" ? "Your message" : "Chat reply"
								}
								className="space-y-2"
							>
								{message.role === "user" ? (
									<div className="whitespace-pre-wrap break-words rounded-lg bg-brand px-4 py-3 leading-relaxed text-primary-foreground">
										{message.text}
									</div>
								) : (
									<ChatReply
										message={message}
										activity={session.activity}
										onOpenLink={openLink}
									/>
								)}
								{message.status === "stopped" || message.status === "failed" ? (
									<p className="text-xs text-muted-foreground">
										{message.status === "stopped"
											? "Stopped"
											: "Reply incomplete"}
									</p>
								) : null}
							</article>
						))}
					</div>
					<div className="shrink-0 space-y-2 border-t border-border px-4 pb-3 pt-2">
						{session.error || error ? (
							<p role="alert" className="text-xs text-destructive">
								{session.error || error}
							</p>
						) : null}
						{!models.length && !busy ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() => void refreshChatConnection()}
							>
								Try again
							</Button>
						) : null}
						{!fileReady && doc.status === "error" ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => void loadPath(tab.path)}
							>
								Try opening file again
							</Button>
						) : null}
						<ChatComposer
							key={tabId}
							text={chat.draft}
							onEdit={(draft) =>
								updateTabChat(tabId, (current) => ({ ...current, draft }))
							}
							onSend={send}
						/>
						<div className="flex items-center gap-3">
							<ChatModelPicker
								models={models}
								value={model}
								disabled={connection.sending || busy || !models.length}
								onValueChange={(model) =>
									updateTabChat(tabId, (current) => ({ ...current, model }))
								}
							/>
							{error || (!models.length && !busy) ? (
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Chat settings"
									title="Chat settings"
									onClick={onOpenSettings}
								>
									···
								</Button>
							) : null}
							<div className="ms-auto">
								{connection.sending ? (
									<Button size="sm" variant="outline" onClick={stopChat}>
										Stop
									</Button>
								) : (
									<Button
										size="icon-sm"
										aria-label="Send message"
										title="Send message"
										disabled={
											!chat.draft.trim() ||
											!model ||
											!fileReady ||
											busy ||
											session.checking
										}
										onClick={send}
									>
										<SendArrow />
									</Button>
								)}
							</div>
						</div>
					</div>
				</>
			)}
		</aside>
	);
}
