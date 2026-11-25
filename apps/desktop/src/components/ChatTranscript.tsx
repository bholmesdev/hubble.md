import type { Ref } from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteQuoteLeftFill from "~icons/mingcute/quote-left-fill";
import { CHAT_CONTEXT_LIMIT, type ChatAttachment } from "../desktopApi/chat";
import { transcriptParts } from "../desktopApi/chatTranscript";
import { quotePreview, shortQuote } from "../lib/quotePreview";

export function ChatTranscript({
	text,
	attachments,
	onReveal,
	onRemove,
	onEdit,
	readOnly,
	promptRef,
	placeholder,
	onSend,
	inBubble = false,
}: {
	text: string;
	attachments: ChatAttachment[];
	onReveal: (attachment: ChatAttachment) => void;
	onRemove?: (id: string) => void;
	onEdit?: (text: string, part: number) => void;
	readOnly?: boolean;
	promptRef?: Ref<HTMLTextAreaElement>;
	placeholder?: string;
	onSend?: () => void;
	inBubble?: boolean;
}) {
	const parts = transcriptParts(text, attachments);
	return (
		<div
			className={`${onEdit ? "min-h-16 max-h-[min(40vh,20rem)] overflow-y-auto py-1 " : ""}whitespace-pre-wrap break-words leading-relaxed select-text`}
		>
			{parts.map((part, index) => {
				const preview = part.attachment
					? quotePreview(part.attachment.text)
					: "";
				return (
					<span key={part.attachment?.id ?? "tail"}>
						{onEdit ? (
							<textarea
								ref={index === parts.length - 1 ? promptRef : undefined}
								aria-label={
									index === 0
										? "Message Chat"
										: `Message Chat continuation ${index + 1}`
								}
								placeholder={
									index === parts.length - 1 ? placeholder : undefined
								}
								rows={parts.length === 1 ? 2 : 1}
								className="block min-h-6 max-h-[min(40vh,20rem)] w-full resize-none border-0 bg-transparent py-1 outline-hidden [field-sizing:content]"
								value={part.text}
								readOnly={readOnly}
								maxLength={CHAT_CONTEXT_LIMIT - text.length + part.text.length}
								onChange={(event) =>
									onEdit(
										text.slice(0, part.start) +
											event.target.value +
											text.slice(part.start + part.text.length),
										index,
									)
								}
								onKeyDown={(event) => {
									if (
										event.key === "Enter" &&
										!event.shiftKey &&
										!event.nativeEvent.isComposing
									) {
										event.preventDefault();
										onSend?.();
									}
								}}
							/>
						) : (
							part.text
						)}
						{part.attachment ? (
							<span
								className={`my-1 inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 align-middle text-xs ${inBubble ? "bg-white/15 text-primary-foreground" : "bg-brand/10 text-brand"}`}
							>
								<button
									type="button"
									className="flex min-w-0 items-center gap-1.5 text-start hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
									title={preview}
									aria-label={`Reveal selection: ${part.attachment.text}`}
									onClick={() => part.attachment && onReveal(part.attachment)}
								>
									<MingcuteQuoteLeftFill
										aria-hidden="true"
										className="size-3 shrink-0"
									/>
									<span className="truncate">{shortQuote(preview)}</span>
								</button>
								{onRemove ? (
									<button
										type="button"
										className="shrink-0 rounded-sm p-0.5 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
										aria-label={`Remove attachment: ${part.attachment.text}`}
										onClick={() =>
											part.attachment && onRemove(part.attachment.id)
										}
									>
										<MingcuteCloseLine aria-hidden="true" className="size-3" />
									</button>
								) : null}
							</span>
						) : null}
					</span>
				);
			})}
		</div>
	);
}
