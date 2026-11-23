import { Button } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { useEffect, useRef, useState } from "react";
import MingcuteArrowRightLine from "~icons/mingcute/arrow-right-line";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteEditLine from "~icons/mingcute/edit-line";
import MingcuteOpenaiLine from "~icons/mingcute/openai-line";
import { desktopApi } from "../desktopApi";
import {
	CHAT_CONTEXT_LIMIT,
	type ChatMessage,
	chatFile,
	chatInput,
} from "../desktopApi/chat";
import { basename, isEditableFile } from "../lib/filePath";
import { isVirtualPath } from "../lib/newTabPage";
import {
	attempt,
	chatConnection,
	errorText,
	refreshChatConnection,
} from "../store/chatConnection";
import { viewerStore, workspacePathStore } from "../store/state";

import { chatPanelOpen, EMPTY_CHAT, updateTabChat } from "../store/tabChat";
import { tabsStore } from "../store/tabStore";
import type { TabId } from "../store/tabs";

export const TOGGLE_CHAT_EVENT = "hubble:toggle-chat";

export function ChatPanel({
	tabId,
	onOpenSettings,
}: {
	tabId: TabId | null;
	onOpenSettings: () => void;
}) {
	const open = useStoreValue(chatPanelOpen);
	const tabs = useStoreValue(tabsStore);
	const tab = tabs.byId[tabId ?? ""];
	const chat = tab?.chat ?? EMPTY_CHAT;
	const document = useStoreValue(viewerStore);
	const workspace = useStoreValue(workspacePathStore);
	const filePath = tab?.path && !isVirtualPath(tab.path) ? tab.path : null;
	const editable = Boolean(filePath && isEditableFile(filePath));
	const fileReady =
		!filePath ||
		!editable ||
		(tabs.activeTabId === tabId &&
			document.currentPath === filePath &&
			document.status === "ready");
	const { messages, draft, model: selectedModel } = chat;
	function setMessages(
		update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[]),
	) {
		if (tabId)
			updateTabChat(tabId, (chat) => ({
				...chat,
				messages: typeof update === "function" ? update(chat.messages) : update,
			}));
	}
	function setDraft(draft: string) {
		if (tabId) updateTabChat(tabId, (chat) => ({ ...chat, draft }));
	}
	function setModel(model: string) {
		if (tabId) updateTabChat(tabId, (chat) => ({ ...chat, model }));
	}

	const {
		account,
		models,
		busy: accountBusy,
		error: connectionError,
		revision,
		sending,
		signingIn,
	} = useStoreValue(chatConnection);
	const model = models.some((item) => item.slug === selectedModel)
		? selectedModel
		: (models[0]?.slug ?? "");
	const [error, setError] = useState<string | null>(null);
	const [scrolled, setScrolled] = useState(false);
	const active = useRef<string | null>(null);
	const transcript = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const toggle = () => chatPanelOpen.set(!chatPanelOpen.get());
		window.addEventListener(TOGGLE_CHAT_EVENT, toggle);
		const unsubscribe = desktopApi.onChatDelta(({ id, text }) => {
			if (id !== active.current) return;
			if (tabId)
				updateTabChat(tabId, (chat) => ({
					...chat,
					messages: chat.messages.map((message) =>
						message.id === id
							? { ...message, text: message.text + text }
							: message,
					),
				}));
		});
		return () => {
			window.removeEventListener(TOGGLE_CHAT_EVENT, toggle);
			unsubscribe();
			if (active.current)
				void desktopApi.chatStop(active.current).catch(() => {});
			if (active.current && tabId)
				updateTabChat(tabId, (chat) => ({
					...chat,
					messages: chat.messages.map((message) =>
						message.status === "streaming"
							? { ...message, status: "stopped" }
							: message,
					),
				}));
			active.current = null;
			chatConnection.set({ ...chatConnection.get(), sending: false });
		};
	}, [tabId]);

	useEffect(() => {
		if (open) void refreshChatConnection();
	}, [open]);
	useEffect(() => {
		// Sign-out clears saved chats in the store; discard any transient request error.
		if (!revision) return;
		if (active.current)
			void desktopApi.chatStop(active.current).catch(() => {});
		active.current = null;

		setError(null);
	}, [revision]);

	useEffect(() => {
		if (open && messages.length)
			transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
		setScrolled(open && (transcript.current?.scrollTop ?? 0) > 0);
	}, [open, messages]);

	async function send() {
		if (
			active.current ||
			accountBusy ||
			!model ||
			!account?.sharing ||
			!draft.trim() ||
			!fileReady
		)
			return;
		// Capture the editor buffer before the request; later edits must not rewrite history.
		const path =
			filePath && workspace && filePath.startsWith(`${workspace}/`)
				? filePath.slice(workspace.length + 1)
				: filePath;
		const file =
			path && editable ? chatFile(messages, path, document.content) : undefined;
		const user: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			text: draft.trim(),
			file: file ?? null,
			status: "complete",
		};
		const history = [...messages, user];
		if (
			history.length > 99 ||
			chatInput(history).reduce(
				(size, message) => size + message.content.length,
				0,
			) > CHAT_CONTEXT_LIMIT
		) {
			setError("Chat is too long. Start a new chat.");
			return;
		}
		const id = crypto.randomUUID();
		active.current = id;

		chatConnection.set({ ...chatConnection.get(), sending: true });
		setError(null);
		setModel(model);
		setDraft("");
		setMessages([
			...history,
			{ id, role: "assistant", text: "", status: "streaming" },
		]);
		const result = await attempt(() =>
			desktopApi.chatSend({ id, model, messages: history }),
		);
		if (active.current !== id) return;
		if (result.ok) {
			const reply = result.value;
			setMessages((messages) =>
				messages.map((message) =>
					message.id === id
						? { ...message, text: reply.text, status: reply.status }
						: message,
				),
			);
			if (reply.error) setError(reply.error);
		} else {
			setError(result.error);
			setMessages((messages) =>
				messages.map((message) =>
					message.id === id ? { ...message, status: "failed" } : message,
				),
			);
		}

		if (active.current === id) {
			active.current = null;

			chatConnection.set({ ...chatConnection.get(), sending: false });
		}
	}

	if (!open || !tabId) return null;

	return (
		<aside
			aria-label="ChatGPT chat"
			className="flex h-full w-[360px] max-w-[85vw] shrink-0 flex-col border-s border-border bg-background text-sm"
		>
			<header
				className={`relative flex h-9 shrink-0 items-center justify-between px-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-dashed ${scrolled ? "after:border-border" : "after:border-transparent"}`}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="New chat"
					title="New chat"
					disabled={sending}
					onClick={() => {
						setMessages([]);
						setDraft("");
						setError(null);
					}}
				>
					<MingcuteEditLine aria-hidden="true" className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close chat"
					title="Close chat"
					onClick={() => chatPanelOpen.set(false)}
				>
					<MingcuteCloseLine aria-hidden="true" className="size-4" />
				</Button>
			</header>
			{!account?.connected && !messages.length ? (
				<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
					<div className="flex w-full max-w-sm flex-col gap-3">
						<MingcuteOpenaiLine
							aria-hidden="true"
							className="mb-3 size-12 self-center text-muted-foreground"
						/>
						<button
							type="button"
							data-oai-siwc-button
							disabled={accountBusy && !signingIn}
							onClick={() =>
								signingIn
									? void desktopApi
											.chatCancelSignIn()
											.catch((error) => setError(errorText(error)))
									: void refreshChatConnection(true)
							}
							className="flex w-full items-center gap-2.5 rounded-md border border-border px-3 py-2 text-start text-sm text-muted-foreground hover:border-brand-accent hover:text-foreground focus-visible:border-brand-accent focus-visible:text-foreground focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
						>
							{signingIn ? "Cancel sign-in" : "Sign in with ChatGPT"}
							{!signingIn ? (
								<MingcuteArrowRightLine
									aria-hidden="true"
									className="ms-auto size-4 shrink-0"
								/>
							) : null}
						</button>
						<p className="px-3 text-xs text-muted-foreground">
							Use your ChatGPT subscription to chat with your notes
						</p>
						{connectionError || error ? (
							<p role="alert" className="text-xs text-destructive">
								{connectionError || error}
							</p>
						) : null}
					</div>
				</div>
			) : (
				<>
					<div
						ref={transcript}
						onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
						className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4"
						role="log"
						aria-label="Chat messages"
						aria-live="off"
					>
						{!messages.length ? (
							<div className="space-y-2 py-6 text-muted-foreground">
								<p className="font-medium text-foreground">
									Start a conversation.
								</p>
								<p>
									Your current text file is included when you send. Edits are
									attached as new snapshots; earlier versions stay in this chat.
								</p>
								<p className="text-xs">
									Chats stay with this tab, including when you open another
									file. Closing the tab clears its chat.
								</p>
							</div>
						) : null}
						{messages.map((message) => (
							<article key={message.id} className="space-y-2">
								<p className="text-xs font-medium text-muted-foreground">
									{message.role === "user" ? "You" : "ChatGPT"}
								</p>
								{message.file ? (
									<p
										className="truncate text-xs text-muted-foreground"
										title={message.file.path}
									>
										{basename(message.file.path)} ·{" "}
										{message.file.text === undefined ? "unchanged" : "snapshot"}
									</p>
								) : null}
								<div className="whitespace-pre-wrap break-words leading-relaxed select-text">
									{message.text ||
										(message.status === "streaming"
											? "Thinking…"
											: "No reply received.")}
								</div>
								{message.status === "stopped" || message.status === "failed" ? (
									<p className="text-xs text-muted-foreground">
										{message.status === "stopped"
											? "Stopped"
											: "Reply incomplete"}{" "}
										· excluded from later context
									</p>
								) : null}
							</article>
						))}
					</div>
					<div className="space-y-2 border-t border-border p-3">
						{error ? (
							<p role="alert" className="text-xs text-destructive">
								{error}
							</p>
						) : null}
						{connectionError ? (
							<p role="alert" className="text-xs text-destructive">
								{connectionError}
							</p>
						) : null}
						{!accountBusy && (!account?.sharing || !models.length) ? (
							<Button variant="outline" size="sm" onClick={onOpenSettings}>
								Set up ChatGPT in Settings
							</Button>
						) : null}
						<textarea
							aria-label="Message ChatGPT"
							placeholder="Message ChatGPT…"
							className="min-h-24 max-h-48 w-full resize-y rounded-md border border-input bg-background p-2 outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
							value={draft}
							maxLength={CHAT_CONTEXT_LIMIT}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.nativeEvent.isComposing
								) {
									event.preventDefault();
									void send();
								}
							}}
						/>
						<div className="flex items-center justify-between gap-2">
							<select
								aria-label="ChatGPT model"
								className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
								value={model}
								disabled={sending || accountBusy || !models.length}
								onChange={(event) => setModel(event.target.value)}
							>
								{!models.length ? (
									<option value="">
										{accountBusy ? "Connecting…" : "No model available"}
									</option>
								) : null}
								{models.map((item) => (
									<option key={item.slug} value={item.slug}>
										{item.name}
									</option>
								))}
							</select>
							{sending ? (
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										if (active.current)
											void desktopApi
												.chatStop(active.current)
												.catch((error) => setError(errorText(error)));
									}}
								>
									Stop
								</Button>
							) : (
								<Button
									size="sm"
									disabled={
										accountBusy ||
										!model ||
										!account?.sharing ||
										!draft.trim() ||
										!fileReady
									}
									onClick={() => void send()}
								>
									Send
								</Button>
							)}
						</div>
					</div>
				</>
			)}
		</aside>
	);
}
