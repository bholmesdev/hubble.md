import {
	commandReviewThread,
	NewNoteButton,
	ReviewCommentSummary,
	Toolbar as SharedToolbar,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { currentPathStore, reviewThreadsStore } from "../store/state";

type Props = {
	onNewNote: () => void;
};

export function Toolbar({ onNewNote }: Props) {
	const currentPath = useStoreValue(currentPathStore);
	const reviewThreads = useStoreValue(reviewThreadsStore);

	return (
		<SharedToolbar
			currentPath={currentPath ?? null}
			sidebarOpen
			platformInset={false}
			rightSlot={
				<div className="flex items-center gap-1">
					{currentPath && (
						<ReviewCommentSummary
							filePath={currentPath}
							threads={reviewThreads}
							onCommand={commandReviewThread}
						/>
					)}
					<NewNoteButton onClick={onNewNote} />
				</div>
			}
		/>
	);
}
