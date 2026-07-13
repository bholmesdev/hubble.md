import {
	type FindState,
	getFindState,
	selectFindMatch,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { keymatch } from "keymatch";
import { type ReactNode, useEffect, useRef, useState } from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteDownLine from "~icons/mingcute/down-line";
import MingcuteSearchLine from "~icons/mingcute/search-line";
import MingcuteUpLine from "~icons/mingcute/up-line";
import { cn } from "../lib/utils";

export function FindBar({ editor }: { editor: Editor | null }) {
	const [open, setOpen] = useState(false);
	const [findState, setFindState] = useState<FindState>({
		query: "",
		activeIndex: 0,
		matches: [],
	});
	const inputRef = useRef<HTMLInputElement | null>(null);

	const syncFindState = () => {
		if (!editor) return;
		setFindState(getFindState(editor.state));
	};

	const close = () => {
		setOpen(false);
		editor?.commands.clearFindQuery();
		editor?.commands.focus(undefined, { scrollIntoView: false });
	};

	const openFind = () => {
		if (!editor) return;
		const selectedText = editor.state.selection.empty
			? ""
			: editor.state.doc.textBetween(
					editor.state.selection.from,
					editor.state.selection.to,
					"\n",
				);
		setOpen(true);
		if (selectedText) editor.commands.setFindQuery(selectedText);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	};

	useEffect(
		() => {
			if (!editor) return;
			syncFindState();
			editor.on("transaction", syncFindState);
			return () => {
				editor.off("transaction", syncFindState);
			};
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
		[editor, syncFindState],
	);

	useEffect(
		() => {
			const handleKeyDown = (event: KeyboardEvent) => {
				if (open && event.key === "Escape") {
					event.preventDefault();
					close();
					return;
				}
				if (!keymatch(event, "CmdOrCtrl+f")) return;
				if (!editor?.isFocused && !open) return;
				event.preventDefault();
				openFind();
			};
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
		[close, editor, open, openFind],
	);

	if (!editor || !open) return null;

	const matchCount = findState.matches.length;
	const activeLabel =
		findState.query.trim() && matchCount > 0
			? `${findState.activeIndex + 1} of ${matchCount}`
			: findState.query.trim()
				? "No matches"
				: "0 of 0";

	const goToMatch = (direction: -1 | 1) => {
		if (matchCount === 0) return;
		editor.commands.setFindActiveIndex(findState.activeIndex + direction);
		requestAnimationFrame(() => selectFindMatch(editor));
	};

	return (
		<div
			className="absolute z-[6] flex w-[min(22rem,calc(100%-1rem))] origin-(--transform-origin) items-center gap-1 rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 [--transform-origin:top_right] [inset-block-start:0.5rem] [inset-inline-end:0.5rem]"
			data-open
		>
			<MingcuteSearchLine className="size-3.5 shrink-0 text-muted-foreground" />
			<input
				ref={inputRef}
				value={findState.query}
				onChange={(event) => {
					editor.commands.setFindQuery(event.target.value);
					requestAnimationFrame(() => selectFindMatch(editor));
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						close();
						return;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						goToMatch(event.shiftKey ? -1 : 1);
					}
				}}
				placeholder="Find"
				className="h-6 min-w-0 flex-1 border-0 bg-transparent px-1 text-[11px] text-foreground outline-hidden placeholder:text-muted-foreground"
			/>
			<span className="shrink-0 tabular-nums text-muted-foreground">
				{activeLabel}
			</span>
			<FindButton
				label="Previous match"
				disabled={matchCount === 0}
				onClick={() => goToMatch(-1)}
			>
				<MingcuteUpLine className="size-3.5" />
			</FindButton>
			<FindButton
				label="Next match"
				disabled={matchCount === 0}
				onClick={() => goToMatch(1)}
			>
				<MingcuteDownLine className="size-3.5" />
			</FindButton>
			<FindButton label="Close find" onClick={close}>
				<MingcuteCloseLine className="size-3.5" />
			</FindButton>
		</div>
	);
}

function FindButton({
	children,
	disabled,
	label,
	onClick,
}: {
	children: ReactNode;
	disabled?: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className={cn(
				"inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-inner)] text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40",
				"disabled:pointer-events-none disabled:opacity-40",
			)}
		>
			{children}
		</button>
	);
}
