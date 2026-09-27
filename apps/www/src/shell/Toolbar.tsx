import {
	commandReviewThread,
	EditableFileTitle,
	NewNoteButton,
	ReviewCommentSummary,
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
		<div className="relative flex h-9 min-w-0 select-none items-center overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border">
			<div
				className="shrink-0"
				style={{ inlineSize: "var(--sidebar-width, 220px)" }}
			/>
			<div className="flex min-w-0 flex-auto justify-center">
				<EditableFileTitle
					key={currentPath}
					currentPath={currentPath ?? null}
				/>
			</div>
			<div
				className="flex items-center justify-end ps-2"
				style={{ flex: "0 100 114px" }}
			>
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
			</div>
		</div>
	);
}
