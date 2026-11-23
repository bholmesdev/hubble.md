import { selectionToMarkdown } from "@hubble.md/editor";
import { Button, getActiveEditor } from "@hubble.md/ui";
import { useEffect, useRef, useState } from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import { desktopApi } from "../desktopApi";
import {
	CHAT_CONTEXT_LIMIT,
	type ChatAccount,
	type ChatMessage,
	type ChatModel,
	type ChatQuote,
	chatInput,
} from "../desktopApi/chat";
import { isChangelogPath } from "../lib/changelogNote";
import { basename } from "../lib/filePath";

export const TOGGLE_CHAT_EVENT = "hubble:toggle-chat";

export function ChatPanel({ filePath }: { filePath: string | null }) {
	const [open, setOpen] = useState(false);
	const [account, setAccount] = useState<ChatAccount | null>(null);
	const [models, setModels] = useState<ChatModel[]>([]);
	const [model, setModel] = useState("");
	const [accountBusy, setAccountBusy] = useState(false);
	const [signingIn, setSigningIn] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [draft, setDraft] = useState("");
	const [quotes, setQuotes] = useState<ChatQuote[]>([]);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const active = useRef<string | null>(null);
	const transcript = useRef<HTMLDivElement>(null);
	const composer = useRef<HTMLTextAreaElement>(null);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		const toggle = () => setOpen((value) => !value);
		window.addEventListener(TOGGLE_CHAT_EVENT, toggle);
		const unsubscribe = desktopApi.onChatDelta(({ id, text }) => {
			if (id !== active.current) return;
			setMessages((messages) =>
				messages.map((message) =>
					message.id === id
						? { ...message, text: message.text + text }
						: message,
				),
			);
		});
		return () => {
			mounted.current = false;
			window.removeEventListener(TOGGLE_CHAT_EVENT, toggle);
			unsubscribe();
			if (active.current)
				void desktopApi.chatStop(active.current).catch(() => {});
			active.current = null;
		};
	}, []);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setAccountBusy(true);
		void attempt(() => loadConnection(false)).then((result) => {
			if (cancelled) return;
			if (!result.ok) setError(result.error);
			else {
				setAccount(result.value.account);
				setModels(result.value.models);
				if (result.value.error) setError(result.value.error);
				setModel((model) =>
					result.value.models.some((item) => item.slug === model)
						? model
						: (result.value.models[0]?.slug ?? ""),
				);
			}
			setAccountBusy(false);
		});
		return () => {
			cancelled = true;
		};
	}, [open]);

	useEffect(() => {
		if (open && messages.length)
			transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
	}, [open, messages]);

	async function connect() {
		setError(null);
		setSigningIn(true);
		setAccountBusy(true);
		const result = await attempt(() => loadConnection(true));
		if (!mounted.current) return;
		if (!result.ok) setError(result.error);
		else {
			const { account, models } = result.value;
			setAccount(account);
			setModels(models);
			setModel(models[0]?.slug ?? "");
			if (result.value.error) setError(result.value.error);
			else if (!account.sharing)
				setError("Enable ChatGPT plan usage in Manage usage, then reconnect.");
			else if (!models.length)
				setError(
					"No models available for this account. Check Manage usage, then reconnect.",
				);
		}
		setSigningIn(false);
		setAccountBusy(false);
	}

	async function disconnect() {
		setAccountBusy(true);
		setError(null);
		const result = await attempt(() => desktopApi.chatDisconnect());
		if (!mounted.current) return;
		if (!result.ok) setError(result.error);
		setAccount(null);
		setModels([]);
		setModel("");
		setMessages([]);
		setQuotes([]);
		setDraft("");
		setAccountBusy(false);
	}

	function addSelection() {
		const editor = getActiveEditor();
		if (
			!filePath ||
			isChangelogPath(filePath) ||
			!editor ||
			editor.state.selection.empty
		) {
			setError("Select a passage in the rich text editor, then add it here.");
			return;
		}
		const text = selectionToMarkdown(editor.state.selection);
		if (
			quotes.length >= 20 ||
			text.length +
				quotes.reduce((size, quote) => size + quote.text.length, 0) >
				CHAT_CONTEXT_LIMIT
		) {
			setError(
				"Too much quoted text. Remove a quote or select a shorter passage.",
			);
			return;
		}
		setQuotes((quotes) => [
			...quotes,
			{ id: crypto.randomUUID(), source: basename(filePath), text },
		]);
		setError(null);
		composer.current?.focus();
	}

	async function send() {
		if (
			active.current ||
			accountBusy ||
			signingIn ||
			!model ||
			!account?.sharing ||
			(!draft.trim() && !quotes.length)
		)
			return;
		const user: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			text: draft.trim(),
			quotes,
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
			setError("Chat is too long. Start a new chat or remove quotes.");
			return;
		}
		const id = crypto.randomUUID();
		active.current = id;
		setSending(true);
		setError(null);
		setDraft("");
		setQuotes([]);
		setMessages([
			...history,
			{ id, role: "assistant", text: "", quotes: [], status: "streaming" },
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
			setSending(false);
		}
	}

	if (!open) return null;

	return (
		<aside
			aria-label="ChatGPT chat"
			className="flex h-full w-[360px] max-w-[85vw] shrink-0 flex-col border-s border-border bg-background text-sm"
		>
			<header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
				<div className="flex items-center gap-2 font-medium">
					ChatGPT{" "}
					<span className="text-[10px] font-normal text-muted-foreground">
						Prototype
					</span>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						disabled={sending}
						onClick={() => {
							setMessages([]);
							setQuotes([]);
							setDraft("");
							setError(null);
						}}
					>
						New chat
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close chat"
						onClick={() => setOpen(false)}
					>
						<MingcuteCloseLine className="size-4" />
					</Button>
				</div>
			</header>
			<div className="space-y-2 border-b border-border p-3">
				{account?.label ? (
					<p className="truncate text-xs text-muted-foreground">
						{account.label}
					</p>
				) : null}
				<div className="flex flex-wrap items-center gap-1">
					{signingIn ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								void desktopApi
									.chatCancelSignIn()
									.catch((error) => setError(errorText(error)))
							}
						>
							Cancel sign-in
						</Button>
					) : (
						<Button
							data-oai-siwc-button
							variant="outline"
							size="sm"
							disabled={accountBusy || sending}
							onClick={() => void connect()}
						>
							{account?.connected
								? "Reconnect ChatGPT"
								: "Continue with ChatGPT"}
						</Button>
					)}
					{account?.label ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={accountBusy || sending}
							onClick={() => void disconnect()}
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
								.catch((error) => setError(errorText(error)))
						}
					>
						Manage usage
					</Button>
				</div>
				{models.length ? (
					<label className="block text-xs text-muted-foreground">
						Using ChatGPT plan
						<select
							aria-label="ChatGPT model"
							className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-foreground"
							value={model}
							disabled={sending || accountBusy}
							onChange={(event) => setModel(event.target.value)}
						>
							{models.map((model) => (
								<option key={model.slug} value={model.slug}>
									{model.name}
								</option>
							))}
						</select>
					</label>
				) : (
					<p className="text-xs text-muted-foreground">
						{accountBusy
							? "Connecting…"
							: "Connect an eligible ChatGPT Plus or Pro plan."}
					</p>
				)}
			</div>
			<div
				ref={transcript}
				className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4"
				role="log"
				aria-label="Chat messages"
				aria-live="off"
			>
				{!messages.length ? (
					<div className="space-y-2 py-6 text-muted-foreground">
						<p className="font-medium text-foreground">
							Think through a passage.
						</p>
						<p>
							Select text in your note and add it below. Only messages and
							attached quotes are sent.
						</p>
						<p className="text-xs">
							Chats last until you switch folders or quit. This prototype asks
							you to reconnect when sign-in expires.
						</p>
					</div>
				) : null}
				{messages.map((message) => (
					<article key={message.id} className="space-y-2">
						<p className="text-xs font-medium text-muted-foreground">
							{message.role === "user" ? "You" : "ChatGPT"}
						</p>
						{message.quotes.map((quote) => (
							<Quote key={quote.id} quote={quote} />
						))}
						<div className="whitespace-pre-wrap break-words leading-relaxed select-text">
							{message.text ||
								(message.status === "streaming"
									? "Thinking…"
									: "No reply received.")}
						</div>
						{message.status === "stopped" || message.status === "failed" ? (
							<p className="text-xs text-muted-foreground">
								{message.status === "stopped" ? "Stopped" : "Reply incomplete"}{" "}
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
				<Button
					variant="outline"
					size="sm"
					disabled={!filePath || sending}
					onMouseDown={(event) => event.preventDefault()}
					onClick={addSelection}
				>
					Add selection
				</Button>
				{quotes.map((quote) => (
					<Quote
						key={quote.id}
						quote={quote}
						onRemove={() =>
							setQuotes((quotes) =>
								quotes.filter((item) => item.id !== quote.id),
							)
						}
					/>
				))}
				<textarea
					ref={composer}
					aria-label="Message ChatGPT"
					placeholder="Ask about your notes…"
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
					<p className="text-[10px] text-muted-foreground">
						Quotes are snapshots. Enter to send.
					</p>
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
								(!draft.trim() && !quotes.length)
							}
							onClick={() => void send()}
						>
							Send
						</Button>
					)}
				</div>
			</div>
		</aside>
	);
}

function Quote({
	quote,
	onRemove,
}: {
	quote: ChatQuote;
	onRemove?: () => void;
}) {
	return (
		<blockquote className="rounded-md border border-border bg-muted/30 p-2 text-xs">
			<div className="flex items-center justify-between gap-2">
				<span className="truncate font-medium">{quote.source}</span>
				{onRemove ? (
					<button
						type="button"
						aria-label={`Remove quote from ${quote.source}`}
						className="shrink-0 rounded-sm p-1 hover:bg-accent"
						onClick={onRemove}
					>
						<MingcuteCloseLine className="size-3" />
					</button>
				) : null}
			</div>
			<p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground select-text">
				{quote.text}
			</p>
		</blockquote>
	);
}

function errorText(error: unknown) {
	return error instanceof Error
		? error.message.replace(
				/^Error invoking remote method '[^']+': (?:Error: )?/,
				"",
			)
		: "ChatGPT is unavailable. Try again.";
}

async function loadConnection(signIn: boolean) {
	const account = signIn
		? await desktopApi.chatSignIn()
		: await desktopApi.chatAccount();
	const catalog = await attempt(() =>
		account.sharing ? desktopApi.chatModels() : Promise.resolve([]),
	);
	return {
		account,
		models: catalog.ok ? catalog.value : [],
		error: catalog.ok ? null : catalog.error,
	};
}

// React Compiler cannot compile try/catch around these component event handlers.
async function attempt<T>(
	action: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	try {
		return { ok: true, value: await action() };
	} catch (error) {
		return { ok: false, error: errorText(error) };
	}
}
