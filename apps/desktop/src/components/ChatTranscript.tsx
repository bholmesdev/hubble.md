import { Button as BaseButton } from "@base-ui/react/button";
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
				// Use one collapsible display space at quote boundaries; keep stored text intact.
				let display = part.text;
				if (index > 0) display = display.replace(/^[\p{Zs}\t]+/u, "");
				if (part.attachment) display = display.replace(/[\p{Zs}\t]+$/u, "");
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
							display
						)}
						{part.attachment ? (
							<>
								{!onEdit ? <span className="whitespace-normal"> </span> : null}
								<span
									className={`my-1 inline rounded-md box-decoration-clone whitespace-normal px-2 py-1 align-baseline text-xs leading-[inherit] ${inBubble ? "bg-white/15 text-primary-foreground" : "bg-brand/10 text-brand"}`}
								>
									{/* Native buttons form one unbreakable box in inline text. */}
									<BaseButton
										nativeButton={false}
										render={<span />}
										className="inline cursor-pointer whitespace-normal text-start leading-[inherit] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
										title={preview}
										aria-label={`Reveal selection: ${part.attachment.text}`}
										onClick={() => part.attachment && onReveal(part.attachment)}
									>
										<QuoteLabel text={shortQuote(preview)} />
									</BaseButton>
									{onRemove ? (
										<button
											type="button"
											className="ms-1 inline-block rounded-sm p-0.5 align-baseline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
											aria-label={`Remove attachment: ${part.attachment.text}`}
											onClick={() =>
												part.attachment && onRemove(part.attachment.id)
											}
										>
											<MingcuteCloseLine
												aria-hidden="true"
												className="size-3"
											/>
										</button>
									) : null}
								</span>
								{!onEdit ? <span className="whitespace-normal"> </span> : null}
							</>
						) : null}
					</span>
				);
			})}
		</div>
	);
}

function QuoteLabel({ text }: { text: string }) {
	const space = text.indexOf(" ");
	return (
		<>
			<span className={space < 0 ? undefined : "whitespace-nowrap"}>
				<MingcuteQuoteLeftFill
					aria-hidden="true"
					className="me-1.5 inline-block size-3 align-[-0.1em]"
				/>
				{space < 0 ? text : text.slice(0, space)}
			</span>
			{space < 0 ? "" : text.slice(space)}
		</>
	);
}
