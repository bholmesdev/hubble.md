import type { ReviewMarkAttrs } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";

/** A thread as it exists in the document, positioned in the editor. */
export type ReviewComment = {
	id: string;
	from: number;
	to: number;
	attrs: ReviewMarkAttrs;
};

/** A thread as everything outside the editor sees it: plain data, so the
 * toolbar can list threads without holding an editor instance. */
export type ReviewThread = {
	id: string;
	/** The commented text itself. */
	anchor: string;
	body: string;
	resolved: boolean;
};

export const REVIEW_THREAD_COMMAND_EVENT = "hubble:review-thread-command";

/** Acts on a thread from outside the editor. */
export type ReviewThreadCommand = {
	kind: "open" | "toggleResolved" | "delete";
	id: string;
};

/** Signals across the editor's tree boundary the way the format menu and code
 * block copy already do, so acting on a thread stays an action rather than a
 * piece of state something has to notice changed. */
export function commandReviewThread(
	kind: ReviewThreadCommand["kind"],
	id: string,
) {
	window.dispatchEvent(
		new CustomEvent<ReviewThreadCommand>(REVIEW_THREAD_COMMAND_EVENT, {
			detail: { kind, id },
		}),
	);
}

export function unresolvedThreads(threads: ReviewThread[]) {
	return threads.filter((thread) => !thread.resolved);
}

/** Prompt for handing a single thread to an agent. The id is stable, so the
 * agent can find the thread even after the surrounding text moves. */
export function buildReviewAgentPrompt({
	filePath,
	commentId,
}: {
	filePath: string;
	commentId: string;
}) {
	return `Address comment ${commentId} in ${filePath}`;
}

/** Prompt for handing every open thread over at once. Unresolved threads are
 * identifiable from the file itself, so the prompt names no ids and stays
 * correct as threads are resolved. */
export function buildReviewCommentsAgentPrompt({
	filePath,
}: {
	filePath: string;
}) {
	return `Address the unresolved comments in ${filePath}`;
}

/** Replaces a thread's mark wholesale. Marks are immutable, so every edit to a
 * thread is a remove followed by an add over the same range. */
export function updateComment(
	editor: Editor,
	comment: ReviewComment,
	attrs: ReviewMarkAttrs,
) {
	const markType = editor.state.schema.marks.reviewMark;
	if (!markType) return;
	const transaction = editor.state.tr.removeMark(
		comment.from,
		comment.to,
		markType,
	);
	transaction.addMark(comment.from, comment.to, markType.create(attrs));
	editor.view.dispatch(transaction);
}

export function setCommentResolved(
	editor: Editor,
	comment: ReviewComment,
	resolved: boolean,
) {
	const attrs: ReviewMarkAttrs = { ...comment.attrs, resolved };
	updateComment(editor, comment, attrs);
	return attrs;
}

/** Drops the thread and leaves its anchored text in place. */
export function deleteComment(editor: Editor, comment: ReviewComment) {
	const markType = editor.state.schema.marks.reviewMark;
	if (!markType) return;
	editor.view.dispatch(
		editor.state.tr.removeMark(comment.from, comment.to, markType),
	);
}

/** Flattens a positioned thread into the plain form the toolbar renders. */
export function toReviewThread(
	editor: Editor,
	comment: ReviewComment,
): ReviewThread {
	return {
		id: comment.id,
		anchor: editor.state.doc.textBetween(comment.from, comment.to, "\n"),
		body: comment.attrs.body ?? "",
		resolved: comment.attrs.resolved === true,
	};
}

/** Copies a prompt and reports the outcome. Every surface that hands work to an
 * agent does exactly this, and keeping the clipboard's try/catch out of the
 * components leaves them plain render logic. */
export async function copyAgentPrompt(
	prompt: string,
	onMessage?: (message: string, type: "success" | "error") => void,
) {
	try {
		await navigator.clipboard.writeText(prompt);
	} catch {
		onMessage?.("Could not copy agent prompt", "error");
		return false;
	}
	onMessage?.("Agent prompt copied", "success");
	return true;
}
