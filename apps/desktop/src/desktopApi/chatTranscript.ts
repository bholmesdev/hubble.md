import { diffChars } from "diff";
import type { ChatAttachment, ChatConversation } from "./chat";

export function transcriptParts(
	text: string,
	attachments: ChatAttachment[] = [],
) {
	const parts: { text: string; attachment?: ChatAttachment; start: number }[] =
		[];
	let start = 0;
	for (const attachment of attachments
		.filter((item) => item.offset !== undefined)
		.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))) {
		const end = Math.max(start, Math.min(text.length, attachment.offset ?? 0));
		parts.push({ text: text.slice(start, end), attachment, start });
		start = end;
	}
	parts.push({ text: text.slice(start), start });
	return parts;
}

/** Recognition revises earlier words; manual edits stay on their side of a pill. */
export function editChatDraft(
	chat: ChatConversation,
	draft: string,
	part?: number,
): ChatConversation {
	if (!chat.attachments?.some((item) => item.offset !== undefined))
		return { ...chat, draft };
	if (part !== undefined) {
		const following = new Set(
			transcriptParts(chat.draft, chat.attachments)
				.slice(part)
				.map((item) => item.attachment?.id),
		);
		const delta = draft.length - chat.draft.length;
		return {
			...chat,
			draft,
			attachments: chat.attachments.map((item) =>
				item.offset !== undefined && following.has(item.id)
					? { ...item, offset: item.offset + delta }
					: item,
			),
		};
	}
	const changes = diffChars(chat.draft, draft);
	return {
		...chat,
		draft,
		attachments: chat.attachments.map((attachment) => {
			if (attachment.offset === undefined) return attachment;
			let before = 0;
			let after = 0;
			for (const change of changes) {
				if (change.added) {
					if (before === attachment.offset) {
						// Recognition can finish a partial word and add punctuation later.
						const continuation = /[\p{L}\p{N}]/u.test(
							chat.draft[before - 1] ?? "",
						)
							? /^[\p{L}\p{N}'’.-]*[.,!?;:]*/u
							: /^[.,!?;:]+/;
						after += change.value.match(continuation)?.[0].length ?? 0;
						break;
					}
					after += change.value.length;
				} else {
					if (before + change.value.length > attachment.offset) {
						if (!change.removed) after += attachment.offset - before;
						break;
					}
					before += change.value.length;
					if (!change.removed) after += change.value.length;
				}
			}
			return { ...attachment, offset: Math.min(after, draft.length) };
		}),
	};
}
