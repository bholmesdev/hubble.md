import { useEffect, useSyncExternalStore } from "react";
import {
	ReviewCommentSummary,
	type ReviewCommentSummaryProps,
} from "./ReviewCommentSummary";

/** The review comment button belongs in the toolbar, but everything it needs
 * (the editor, the thread list) lives inside the editor, and the two sit in
 * sibling subtrees. The editor publishes here and apps drop the slot wherever
 * the button should sit, so nothing has to thread props through the app shell.
 */

let published: ReviewCommentSummaryProps | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Called from inside the editor. Publishes nothing while the editor is
 * unmounted, which is what hides the button on a non-editable document. */
export function usePublishReviewComments(props: ReviewCommentSummaryProps) {
	useEffect(() => {
		published = props;
		emit();
		return () => {
			if (published === props) published = null;
			emit();
		};
	}, [props]);
}

export function ReviewCommentSlot({ className }: { className?: string }) {
	const props = useSyncExternalStore(
		subscribe,
		() => published,
		() => null,
	);
	if (!props) return null;
	return (
		<div className={className}>
			<ReviewCommentSummary {...props} />
		</div>
	);
}
