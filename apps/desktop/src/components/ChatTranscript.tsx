import { Button as BaseButton } from "@base-ui/react/button";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteQuoteLeftFill from "~icons/mingcute/quote-left-fill";
import type { ChatAttachment } from "../desktopApi/chat";
import { transcriptParts } from "../desktopApi/chatTranscript";
import { quotePreview, shortQuote } from "../lib/quotePreview";

export function ChatTranscript({
	text,
	attachments,
	onReveal,
}: {
	text: string;
	attachments: ChatAttachment[];
	onReveal: (attachment: ChatAttachment) => void;
}) {
	return (
		<div className="whitespace-pre-wrap break-words leading-relaxed select-text">
			{transcriptParts(text, attachments).map((part, index) => {
				let display = part.text;
				if (index > 0) display = display.replace(/^[\p{Zs}\t]+/u, "");
				if (part.attachment) display = display.replace(/[\p{Zs}\t]+$/u, "");
				return (
					<span key={part.attachment?.id ?? "tail"}>
						{display}
						{part.attachment ? (
							<>
								<span className="whitespace-normal"> </span>
								<QuotePill
									attachment={part.attachment}
									onReveal={onReveal}
									inBubble
								/>
								<span className="whitespace-normal"> </span>
							</>
						) : null}
					</span>
				);
			})}
		</div>
	);
}

export function QuotePill({
	attachment,
	onReveal,
	onRemove,
	inBubble = false,
}: {
	attachment: ChatAttachment;
	onReveal: (attachment: ChatAttachment) => void;
	onRemove?: (id: string) => void;
	inBubble?: boolean;
}) {
	const preview = quotePreview(attachment.text);
	return (
		<span
			className={`my-1 inline rounded-md box-decoration-clone whitespace-normal px-2 py-1 align-baseline text-xs leading-[inherit] ${inBubble ? "bg-white/15 text-primary-foreground" : "bg-[color-mix(in_srgb,var(--brand)_12%,var(--background))] text-foreground"}`}
		>
			{/* Native buttons form one unbreakable box in inline text. */}
			<BaseButton
				nativeButton={false}
				render={<span />}
				className="inline cursor-pointer whitespace-normal text-start leading-[inherit] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
				title={preview}
				aria-label={`Reveal selection: ${attachment.text}`}
				onClick={() => onReveal(attachment)}
			>
				<QuoteLabel text={shortQuote(preview)} />
			</BaseButton>
			{onRemove ? (
				<>
					{/* Keep the remove control with the last word when a quote wraps. */}
					{"\u2060"}
					<button
						type="button"
						className="ms-1 inline-flex size-4 items-center justify-center rounded-sm align-[-0.125em] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
						aria-label={`Remove attachment: ${attachment.text}`}
						onClick={() => onRemove(attachment.id)}
					>
						<MingcuteCloseLine aria-hidden="true" className="size-3" />
					</button>
				</>
			) : null}
		</span>
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
