import MingcuteCloseLine from "~icons/mingcute/close-line";
import type { ChatAttachment } from "../desktopApi/chat";
import { basename } from "../lib/filePath";
import { quotePreview } from "../lib/quotePreview";

export function ChatAttachments({
	attachments,
	onRemove,
}: {
	attachments: ChatAttachment[];
	onRemove?: (id: string) => void;
}) {
	if (!attachments.length) return null;
	return (
		<ul
			aria-label={onRemove ? "Attachments" : "Sent attachments"}
			className="max-h-36 space-y-1.5 overflow-y-auto"
		>
			{attachments.map((attachment) => {
				const quote =
					attachment.kind === "thread"
						? attachment.comments?.[0]?.body || attachment.text
						: attachment.text;
				const preview = quotePreview(quote);
				return (
					<li
						key={attachment.id}
						className="flex min-w-0 items-start gap-2 rounded-md border border-border px-2.5 py-2"
					>
						<div className="min-w-0 flex-1">
							<p className="mb-1 truncate text-[11px] text-muted-foreground">
								{basename(attachment.path)} ·{" "}
								{attachment.kind === "thread" ? "Comment thread" : "Selection"}
							</p>
							<blockquote
								title={preview}
								className="truncate border-s-2 border-border ps-2 text-xs text-foreground"
							>
								{preview}
							</blockquote>
						</div>
						{onRemove && (
							<button
								type="button"
								aria-label={`Remove attachment: ${quote}`}
								title="Remove attachment"
								className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
								onClick={() => onRemove(attachment.id)}
							>
								<MingcuteCloseLine aria-hidden="true" className="size-3.5" />
							</button>
						)}
					</li>
				);
			})}
		</ul>
	);
}
