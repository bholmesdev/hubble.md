import MingcuteAddLine from "~icons/mingcute/add-line";
import { useCommandShortcutLabel } from "../lib/shortcut";
import { Button } from "../primitives/button";

export function NewNoteButton({ onClick }: { onClick: () => void }) {
	const title = useCommandShortcutLabel("New Markdown File", "app.new-file");
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={onClick}
			aria-label="New Markdown File"
			title={title}
		>
			<MingcuteAddLine className="size-4" />
		</Button>
	);
}
