import { useEffect, useRef, useState } from "react";
import { fileNameFromPath } from "../lib/filePath";

export function EditableFileTitle({
	currentPath,
	onRename,
}: {
	currentPath: string | null;
	onRename?: (nextName: string) => void | Promise<void>;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const title = currentPath ? fileNameFromPath(currentPath) : "";
	const editing = draft !== null;

	useEffect(() => {
		if (!editing) return;
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [editing]);

	function commit() {
		const nextTitle = draft?.trim();
		setDraft(null);
		if (nextTitle && nextTitle !== title && onRename) {
			void onRename(nextTitle);
		}
	}

	return editing ? (
		<input
			ref={inputRef}
			aria-label="File name"
			className="h-6 min-w-0 max-w-full select-text rounded-sm bg-transparent px-1 text-center text-xs text-foreground outline-none focus-visible:outline-none focus-visible:ring-0"
			value={draft}
			onBlur={commit}
			onChange={(event) => setDraft(event.target.value)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					commit();
				} else if (event.key === "Escape") {
					event.preventDefault();
					setDraft(null);
				}
			}}
		/>
	) : (
		<button
			type="button"
			className="min-w-0 cursor-default truncate rounded-sm px-1 text-center text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-0"
			onClick={() => setDraft(title)}
			disabled={!title || !onRename}
			tabIndex={onRename ? undefined : -1}
		>
			{title || "\u00A0"}
		</button>
	);
}
