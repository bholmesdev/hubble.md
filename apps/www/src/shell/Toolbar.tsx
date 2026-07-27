import {
	NewNoteButton,
	ReviewCommentSlot,
	Toolbar as SharedToolbar,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { currentPathStore } from "../store/state";

type Props = {
	onNewNote: () => void;
};

export function Toolbar({ onNewNote }: Props) {
	const currentPath = useStoreValue(currentPathStore);

	return (
		<SharedToolbar
			currentPath={currentPath ?? null}
			sidebarOpen
			platformInset={false}
			rightSlot={
				<div className="flex items-center gap-1">
					<ReviewCommentSlot />
					<NewNoteButton onClick={onNewNote} />
				</div>
			}
		/>
	);
}
