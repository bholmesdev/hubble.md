import type { ReviewMarkAttrs } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";

export type ReviewComment = {
	id: string;
	from: number;
	to: number;
	attrs: ReviewMarkAttrs;
};

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

export function unresolvedComments(comments: ReviewComment[]) {
	return comments.filter((comment) => comment.attrs.resolved !== true);
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
