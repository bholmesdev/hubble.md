import { Button, ResizableSidebar } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import MingcuteArrowRightLine from "~icons/mingcute/arrow-right-line";
import MingcuteArrowUpLine from "~icons/mingcute/arrow-up-line";
import MingcuteBugLine from "~icons/mingcute/bug-line";
import MingcuteDownLine from "~icons/mingcute/down-line";
import MingcuteEditLine from "~icons/mingcute/edit-line";
import MingcuteMicLine from "~icons/mingcute/mic-line";
import MingcuteSidebarRightLine from "~icons/mingcute/sidebar-right-line";
import { desktopApi } from "../desktopApi";
import {
	CHAT_CONTEXT_LIMIT,
	type ChatAttachment,
	type ChatMessage,
	chatContextSize,
	chatFile,
} from "../desktopApi/chat";
import { editChatDraft } from "../desktopApi/chatTranscript";
import { isEditableFile } from "../lib/filePath";
import { isVirtualPath } from "../lib/newTabPage";
import { resolveRelativeLinkPath } from "../lib/relativeLinkPath";
import { windowControlsInset } from "../lib/windowChrome";
import { loadPath } from "../store/actions";
import {
	attempt,
	chatConnection,
	errorText,
	refreshChatConnection,
	resetChatConnection,
} from "../store/chatConnection";
import { chatDebug, recordChatPayload } from "../store/chatDebug";
import { handleChatFileRequest } from "../store/chatFiles";
import { getChatPanelState } from "../store/chatPanelState";
import { viewerStore, workspacePathStore } from "../store/state";
import {
	chatPanelOpen,
	chatPanelWidth,
	chatSelection,
	EMPTY_CHAT,
	updateTabChat,
} from "../store/tabChat";
import { tabsStore } from "../store/tabStore";
import type { TabId } from "../store/tabs";
import { isRecording, startVoice, stopVoice, voice } from "../store/voice";
import { ChatAttachments } from "./ChatAttachments";
import { ChatPayloads } from "./ChatPayloads";
import { ChatReply } from "./ChatReply";
import { ChatTranscript } from "./ChatTranscript";
import { VoiceMeter } from "./VoiceMeter";

export const TOGGLE_CHAT_EVENT = "hubble:toggle-chat";

export function ChatPanel({
	tabId,
	onOpenSettings,
	fullHeight = false,
}: {
	tabId: TabId | null;
	onOpenSettings: () => void;
	fullHeight?: boolean;
}) {
	const open = useStoreValue(chatPanelOpen);
	const debugOpen = useStoreValue(chatDebug);
	const width = useStoreValue(chatPanelWidth);
	const panelRef = useRef<HTMLElement>(null);
	const [limit, setLimit] = useState(() => window.innerWidth * 0.85);
	useLayoutEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		const parent = panel?.parentElement;
		const editor =
			panel?.previousElementSibling?.querySelector("[data-chat-editor-area]") ??
			panel?.previousElementSibling;
		if (!parent || !editor) return;
		const measure = () => {
			const left = editor.getBoundingClientRect().left;
			const right = parent.getBoundingClientRect().right || window.innerWidth;
			// Leave room for the editor even when the file sidebar is open.
			setLimit(
				Math.max(280, Math.min(window.innerWidth * 0.85, right - left - 240)),
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(parent);
		observer.observe(editor);
		return () => observer.disconnect();
	}, [open]);
	const panelWidth = Math.min(width, limit);

	const recording = useStoreValue(voice);
	const voiceBusy =
		recording?.tabId === tabId &&
		["starting", "listening", "stopping"].includes(recording.status);
	const recordingLabel =
		recording?.tabId === tabId ? voiceLabel(recording) : null;
	const tabs = useStoreValue(tabsStore);
	const tab = tabs.byId[tabId ?? ""];
	const chat = tab?.chat ?? EMPTY_CHAT;
	const attachments = chat.attachments ?? [];
	const attachmentKey = attachments.map((item) => item.id).join(",");
	const document = useStoreValue(viewerStore);
	const workspace = useStoreValue(workspacePathStore);
	useEffect(() => {
		const current = voice.get();
		if (
			current &&
			(!open || current.tabId !== tabId || current.workspace !== workspace)
		)
			stopVoice();
	}, [open, tabId, workspace]);
	useEffect(() => () => stopVoice(), []);
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
	function setDraft(draft: string, part?: number) {
		if (draft.length > CHAT_CONTEXT_LIMIT) return;
		if (tabId) updateTabChat(tabId, (chat) => editChatDraft(chat, draft, part));
	}
	function setModel(model: string) {
		if (tabId) updateTabChat(tabId, (chat) => ({ ...chat, model }));
	}

	const connection = useStoreValue(chatConnection);
	const {
		models,
		busy: accountBusy,
		error: connectionError,
		revision,
		sending,
		signingIn,
	} = connection;
	const panel = getChatPanelState(
		connection,
		{
			ready: fileReady,
			error:
				filePath && editable && document.status === "error"
					? (document.error ?? "The current file could not be loaded.")
					: null,
		},
		messages.length > 0,
	);
	const model = models.some((item) => item.slug === selectedModel)
		? selectedModel
		: (models[0]?.slug ?? "");
	const [error, setError] = useState<string | null>(null);
	const [activity, setActivity] = useState<string | undefined>();
	const [scrolled, setScrolled] = useState(false);
	const [sendAfterVoice, setSendAfterVoice] = useState<{
		id: string;
		workspace: string | undefined;
		revision: number;
	} | null>(null);
	const active = useRef<string | null>(null);
	const transcript = useRef<HTMLDivElement>(null);
	const prompt = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (
			open &&
			attachmentKey &&
			panel.kind === "conversation" &&
			!(voice.get()?.tabId === tabId && isRecording())
		)
			prompt.current?.focus();
	}, [open, attachmentKey, panel.kind, tabId]);
	function revealSelection(attachment: ChatAttachment) {
		void attempt(async () => {
			if (!tabId) return;
			if (viewerStore.get().currentPath !== attachment.path)
				await loadPath(attachment.path);
			if (tabsStore.get().activeTabId !== tabId) return;
			if (
				viewerStore.get().currentPath !== attachment.path ||
				viewerStore.get().status !== "ready"
			)
				throw new Error("Could not open the selection’s file.");
			chatSelection.set({ ...attachment, tabId });
		}).then((result) => {
			if (!result.ok) setError(result.error);
		});
	}
	function removeAttachment(id: string) {
		if (tabId)
			updateTabChat(tabId, (chat) => ({
				...chat,
				attachments: (chat.attachments ?? []).filter((item) => item.id !== id),
			}));
	}

	useEffect(() => {
		const toggle = () => chatPanelOpen.set(!chatPanelOpen.get());
		window.addEventListener(TOGGLE_CHAT_EVENT, toggle);
		const unsubscribe = desktopApi.onChatDelta(
			({ id, text, context, activity, debug }) => {
				if (debug) {
					recordChatPayload(id, debug);
					return;
				}
				if (id !== active.current) return;
				if (context) setActivity(activity);
				if (tabId)
					updateTabChat(tabId, (chat) => ({
						...chat,
						messages: chat.messages.map((message) =>
							message.id === id
								? {
										...message,
										text: message.text + text,
										...(context ? { context } : {}),
									}
								: message,
						),
					}));
			},
		);
		const unsubscribeFiles = desktopApi.onChatFileRequest((request) => {
			if (request.requestId !== active.current) return;
			void handleChatFileRequest(
				request,
				() => active.current === request.requestId,
			)
				.then((reply) => desktopApi.chatFileReply(reply))
				.catch((error) => {
					if (active.current === request.requestId) setError(errorText(error));
				});
		});
		return () => {
			unsubscribeFiles();
			window.removeEventListener(TOGGLE_CHAT_EVENT, toggle);
			unsubscribe();
			if (active.current)
				void desktopApi.chatStop(active.current).catch(() => {});
			if (active.current && tabId)
				updateTabChat(tabId, (chat) => ({
					...chat,
					messages: chat.messages.map((message) =>
						message.status === "streaming"
							? { ...message, status: "stopped", finishedAt: Date.now() }
							: message,
					),
				}));
			active.current = null;
			chatConnection.set({ ...chatConnection.get(), sending: false });
		};
	}, [tabId]);

	useEffect(() => {
		stopVoice();
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
		if (voiceBusy && sendAfterVoice) return;
		if (voiceBusy && recording) {
			setSendAfterVoice({ id: recording.id, workspace, revision });
			stopVoice();
			return;
		}
		if (
			active.current ||
			voiceBusy ||
			accountBusy ||
			!model ||
			panel.kind !== "conversation" ||
			panel.composer !== "ready" ||
			!draft.trim()
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
			text: attachments.some((item) => item.offset !== undefined)
				? draft
				: draft.trim(),
			file: file ?? null,
			...(attachments.length ? { attachments } : {}),
			status: "complete",
		};
		const history = [...messages, user];
		if (history.length > 99 || chatContextSize(history) > CHAT_CONTEXT_LIMIT) {
			setError("Chat is too long. Start a new chat.");
			return;
		}
		const id = crypto.randomUUID();
		active.current = id;

		chatConnection.set({ ...chatConnection.get(), sending: true });
		setError(null);
		setActivity(undefined);
		setModel(model);
		setDraft("");
		if (tabId) updateTabChat(tabId, (chat) => ({ ...chat, attachments: [] }));
		setMessages([
			...history,
			{
				id,
				role: "assistant",
				text: "",
				status: "streaming",
				startedAt: Date.now(),
			},
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
						? {
								...message,
								text: reply.text,
								status: reply.status,
								finishedAt: Date.now(),
								...(reply.context ? { context: reply.context } : {}),
							}
						: message,
				),
			);
			if (reply.error) setError(reply.error);
		} else {
			setError(result.error);
			setMessages((messages) =>
				messages.map((message) =>
					message.id === id
						? { ...message, status: "failed", finishedAt: Date.now() }
						: message,
				),
			);
		}

		if (active.current === id) {
			active.current = null;

			chatConnection.set({ ...chatConnection.get(), sending: false });
		}
	}

	// Final recognition may revise the draft; send from the render that includes those words.
	const sendTranscript = useEffectEvent(() => {
		void send();
	});
	useEffect(() => {
		if (!sendAfterVoice) return;
		if (
			!open ||
			recording?.id !== sendAfterVoice.id ||
			recording.tabId !== tabId ||
			workspace !== sendAfterVoice.workspace ||
			revision !== sendAfterVoice.revision
		) {
			setSendAfterVoice(null);
			return;
		}
		if (recording.status !== "stopped" && recording.status !== "error") return;
		setSendAfterVoice(null);
		if (recording.status === "stopped") sendTranscript();
	}, [sendAfterVoice, open, recording, tabId, workspace, revision]);

	if (!open || !tabId) return null;

	return (
		<ResizableSidebar
			id="chat-sidebar"
			aria-label="Chat"
			panelRef={panelRef}
			side="right"
			resizeLabel="Resize chat panel"
			width={panelWidth}
			minWidth={280}
			maxWidth={limit}
			onWidthChange={(next) => chatPanelWidth.set(next)}
			onCollapse={() => chatPanelOpen.set(false)}
			className={`h-full min-h-0 bg-background text-sm ${fullHeight ? "col-start-2 row-start-1 row-span-2" : ""}`}
		>
			<header
				style={
					fullHeight
						? {
								paddingInlineEnd: `max(8px, ${windowControlsInset(desktopApi.platform)})`,
							}
						: undefined
				}
				className={`relative flex h-9 shrink-0 items-center justify-between px-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-dashed ${scrolled ? "after:border-border" : "after:border-transparent"} ${fullHeight ? "[-webkit-app-region:drag]" : ""}`}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="New chat"
					className="[-webkit-app-region:no-drag]"
					title="New chat"
					disabled={sending || voiceBusy || panel.kind !== "conversation"}
					onClick={() => {
						setMessages([]);
						if (tabId)
							updateTabChat(tabId, (chat) => ({ ...chat, attachments: [] }));
						setDraft("");
						setError(null);
					}}
				>
					<MingcuteEditLine aria-hidden="true" className="size-4" />
				</Button>
				<div className="ms-auto flex items-center [-webkit-app-region:no-drag]">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={debugOpen ? "Hide API payloads" : "Show API payloads"}
						title={debugOpen ? "Hide API payloads" : "Show API payloads"}
						aria-pressed={debugOpen}
						className="aria-pressed:bg-accent"
						onClick={() => chatDebug.set(!chatDebug.get())}
					>
						<MingcuteBugLine aria-hidden="true" className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close Chat"
						title="Close Chat"
						aria-expanded={true}
						aria-controls="chat-sidebar"
						className="bg-muted text-foreground"
						onClick={() => chatPanelOpen.set(false)}
					>
						<MingcuteSidebarRightLine aria-hidden="true" className="size-4" />
					</Button>
				</div>
			</header>
			{panel.kind === "checking" ? (
				<div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
					<output>Checking chat connection…</output>
				</div>
			) : panel.kind === "reset-required" ? (
				<div className="flex flex-1 items-center justify-center p-6">
					<div className="space-y-3">
						<p role="alert">{panel.message}</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void resetChatConnection()}
						>
							Reset connection and sign in again
						</Button>
					</div>
				</div>
			) : panel.kind === "connection-error" ||
				panel.kind === "setup-required" ? (
				<div className="flex flex-1 items-center justify-center p-6">
					<div className="space-y-3">
						<p role="alert">{panel.message}</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refreshChatConnection()}
						>
							Retry connection
						</Button>
						<Button variant="ghost" size="sm" onClick={onOpenSettings}>
							Chat settings
						</Button>
					</div>
				</div>
			) : panel.kind === "signed-out" || panel.kind === "signing-in" ? (
				<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
					<div className="flex w-full max-w-sm flex-col gap-3">
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
						<ChatAttachments
							attachments={attachments.filter(
								(item) => item.offset === undefined,
							)}
							onRemove={removeAttachment}
						/>
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
						{messages.map((message, index) => (
							<article
								key={message.id}
								aria-label={
									message.role === "user" ? "Your message" : "Chat reply"
								}
								className="space-y-2"
							>
								{message.attachments?.length ? (
									<ChatAttachments
										attachments={message.attachments.filter(
											(item) => item.offset === undefined,
										)}
									/>
								) : null}
								{message.role === "assistant" ? (
									<ChatReply
										message={message}
										activity={activity}
										onOpenLink={(href) => {
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
											}).then((result) => {
												if (!result.ok) setError(result.error);
											});
										}}
									/>
								) : (
									<div className="rounded-xl bg-brand px-4 py-3 text-primary-foreground">
										<ChatTranscript
											text={message.text}
											attachments={message.attachments ?? []}
											onReveal={revealSelection}
											inBubble
										/>
									</div>
								)}

								{message.status === "stopped" || message.status === "failed" ? (
									<p className="text-xs text-muted-foreground">
										{message.status === "stopped"
											? "Stopped"
											: "Reply incomplete"}{" "}
										· partial reply excluded from later context
									</p>
								) : null}
								{debugOpen ? (
									<ChatPayloads
										message={message}
										history={messages.slice(0, index + 1)}
										requestId={
											message.role === "assistant"
												? message.id
												: messages[index + 1]?.role === "assistant"
													? messages[index + 1].id
													: undefined
										}
									/>
								) : null}
							</article>
						))}
					</div>
					<div className="shrink-0 space-y-2 border-t border-border px-4 pb-3 pt-2">
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
						{panel.kind === "conversation" && panel.reason ? (
							<output className="block text-xs text-muted-foreground">
								{panel.reason}
							</output>
						) : null}
						{recordingLabel ? (
							<output className="block text-xs text-muted-foreground">
								{recordingLabel}
							</output>
						) : null}
						<ChatAttachments
							attachments={attachments.filter(
								(item) => item.offset === undefined,
							)}
							onRemove={removeAttachment}
						/>
						<ChatTranscript
							text={draft}
							attachments={attachments}
							onReveal={revealSelection}
							onRemove={removeAttachment}
							onEdit={setDraft}
							readOnly={voiceBusy}
							promptRef={prompt}
							placeholder={voiceBusy ? "Recording..." : "Let's discuss..."}
							onSend={() => void send()}
						/>
						<div className="flex items-center gap-3">
							<div className="relative min-w-0">
								<select
									aria-label="Chat model"
									className="block max-w-full appearance-none rounded-xs border-0 bg-transparent py-1.5 pe-6 text-xs text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 [field-sizing:content]"
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
								<MingcuteDownLine
									aria-hidden="true"
									className="pointer-events-none absolute end-0.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
								/>
							</div>
							<div className="ms-auto flex shrink-0 items-center gap-2">
								{voiceBusy && recording?.status === "listening" ? (
									<VoiceMeter />
								) : null}
								{desktopApi.platform === "darwin" ? (
									<Button
										size="icon-sm"
										variant="ghost"
										aria-label={
											voiceBusy ? "Stop recording" : "Record voice message"
										}
										title={
											voiceBusy ? "Stop recording" : "Record voice message"
										}
										disabled={
											sending ||
											(isRecording() && !voiceBusy) ||
											recording?.status === "stopping" ||
											(!voiceBusy &&
												(panel.kind !== "conversation" ||
													panel.composer !== "ready"))
										}
										onClick={() =>
											voiceBusy ? stopVoice() : void startVoice(tabId)
										}
									>
										{voiceBusy ? (
											<span className="size-2.5 rounded-xs bg-destructive" />
										) : (
											<MingcuteMicLine aria-hidden="true" className="size-4" />
										)}
									</Button>
								) : null}
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
										size="icon-sm"
										aria-label="Send message"
										title={
											voiceBusy ? "Stop recording and send" : "Send message"
										}
										disabled={
											panel.kind !== "conversation" ||
											panel.composer !== "ready" ||
											(!draft.trim() && !voiceBusy) ||
											Boolean(sendAfterVoice)
										}
										onClick={() => void send()}
									>
										<MingcuteArrowUpLine
											aria-hidden="true"
											className="size-4"
										/>
									</Button>
								)}
							</div>
						</div>
					</div>
				</>
			)}
		</ResizableSidebar>
	);
}

function voiceLabel(recording: NonNullable<ReturnType<typeof voice.get>>) {
	switch (recording.status) {
		case "starting":
			return "Starting…";
		case "listening":
			return null;
		case "stopping":
			return "Finishing transcript…";
		case "error":
			return recording.error;
		case "stopped":
			return recording.text?.trim()
				? null
				: "No speech detected. Try recording again.";
	}
}
