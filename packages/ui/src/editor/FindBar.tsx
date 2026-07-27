import {
	type FindState,
	getCommand,
	getFindState,
	selectFindMatch,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { keymatch } from "keymatch";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteCornerDownLeftLine from "~icons/mingcute/corner-down-left-line";
import MingcuteDownLine from "~icons/mingcute/down-line";
import MingcuteRightLine from "~icons/mingcute/right-line";
import MingcuteUpLine from "~icons/mingcute/up-line";
import { formatShortcut } from "../lib/shortcut";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";

export function FindBar({ editor }: { editor: Editor | null }) {
	const [open, setOpen] = useState(false);
	const [replaceOpen, setReplaceOpen] = useState(false);
	const [replacement, setReplacement] = useState("");
	const [findState, setFindState] = useState<FindState>({
		query: "",
		activeIndex: 0,
		matches: [],
	});
	const inputRef = useRef<HTMLInputElement | null>(null);
	const replaceInputRef = useRef<HTMLInputElement | null>(null);

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

	/**
	 * Collapsing unmounts the replace field, so focus moves back to the find
	 * field rather than falling out of the bar entirely.
	 */
	const toggleReplace = (focusField: boolean) => {
		const nextReplaceOpen = !replaceOpen;
		setReplaceOpen(nextReplaceOpen);
		if (!focusField && nextReplaceOpen) return;
		requestAnimationFrame(() => {
			const field = nextReplaceOpen ? replaceInputRef : inputRef;
			field.current?.focus();
		});
	};

	useEffect(
		() => {
			const handleKeyDown = (event: KeyboardEvent) => {
				if (open && event.key === "Escape") {
					event.preventDefault();
					close();
					return;
				}
				if (keymatch(event, "CmdOrCtrl+Alt+f")) {
					if (!editor?.isEditable) return;
					if (!editor.isFocused && !open) return;
					event.preventDefault();
					if (open) toggleReplace(true);
					else {
						setReplaceOpen(true);
						openFind();
					}
					return;
				}
				if (!keymatch(event, getCommand("app.find").defaultBinding)) return;
				if (!editor?.isFocused && !open) return;
				event.preventDefault();
				openFind();
			};
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
		[close, editor, open, openFind, toggleReplace],
	);

	if (!editor || !open) return null;

	// Read-only documents still search, but nothing may rewrite them.
	const canReplace = editor.isEditable;
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

	const replaceCurrent = () => {
		editor.commands.replaceFindMatch(replacement);
		requestAnimationFrame(() => selectFindMatch(editor));
	};

	// Undo restores the selection it was recorded with, so the text that came
	// back is at or just after the caret. Make it the active match and scroll
	// there, since focus stays in the find bar and the editor is not visible.
	const revealHistoryChange = () => {
		const { from } = editor.state.selection;
		const matches = getFindState(editor.state).matches;
		const index = matches.findIndex((match) => match.to >= from);
		if (index === -1) {
			editor.view.dispatch(editor.state.tr.scrollIntoView());
			return;
		}
		editor.commands.setFindActiveIndex(index);
		requestAnimationFrame(() => selectFindMatch(editor));
	};

	/**
	 * Sends undo and redo to the document while the find bar holds focus.
	 * Without this the browser undoes typing in the find input instead, which
	 * leaves replacements stranded.
	 */
	const handleHistoryKeys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		const isUndo = keymatch(event.nativeEvent, "CmdOrCtrl+z");
		const isRedo =
			keymatch(event.nativeEvent, "CmdOrCtrl+Shift+z") ||
			keymatch(event.nativeEvent, "CmdOrCtrl+y");
		if (!isUndo && !isRedo) return false;
		event.preventDefault();
		if (isUndo ? editor.commands.undo() : editor.commands.redo()) {
			requestAnimationFrame(revealHistoryChange);
		}
		return true;
	};

	return (
		<div
			className={cn(
				"absolute z-[6] grid w-[min(22rem,calc(100%-1rem))] origin-(--transform-origin) items-center gap-x-1 gap-y-1.5 rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 [--transform-origin:top_right] [inset-block-start:0.5rem] [inset-inline-end:0.5rem]",
				canReplace ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[1fr_auto]",
			)}
			data-open
		>
			{canReplace && (
				<FindButton
					label={replaceOpen ? "Hide replace" : "Show replace"}
					shortcut="CmdOrCtrl+Alt+F"
					onClick={() => toggleReplace(false)}
				>
					<MingcuteRightLine
						className={cn(
							"size-3.5 transition-transform",
							replaceOpen && "rotate-90",
						)}
					/>
				</FindButton>
			)}
			<div className="flex h-7 min-w-0 items-center gap-1.5">
				<input
					ref={inputRef}
					value={findState.query}
					onChange={(event) => {
						editor.commands.setFindQuery(event.target.value);
						requestAnimationFrame(() => selectFindMatch(editor));
					}}
					onKeyDown={(event) => {
						if (handleHistoryKeys(event)) return;
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
					className="h-full min-w-0 flex-1 border-0 bg-transparent text-[11px] text-foreground outline-hidden placeholder:text-muted-foreground"
				/>
				<span className="shrink-0 tabular-nums text-muted-foreground">
					{activeLabel}
				</span>
			</div>
			<div className="flex items-center gap-1 justify-self-end">
				<FindButton
					label="Previous match"
					shortcut="Shift+Enter"
					disabled={matchCount === 0}
					onClick={() => goToMatch(-1)}
				>
					<MingcuteUpLine className="size-3.5" />
				</FindButton>
				<FindButton
					label="Next match"
					shortcut="Enter"
					disabled={matchCount === 0}
					onClick={() => goToMatch(1)}
				>
					<MingcuteDownLine className="size-3.5" />
				</FindButton>
				<FindButton label="Close find" shortcut="Esc" onClick={close}>
					<MingcuteCloseLine className="size-3.5" />
				</FindButton>
			</div>
			{canReplace && replaceOpen && (
				<>
					<div className="col-span-3 -mx-1 border-border border-t" />
					<input
						ref={replaceInputRef}
						value={replacement}
						onChange={(event) => setReplacement(event.target.value)}
						onKeyDown={(event) => {
							if (handleHistoryKeys(event)) return;
							if (event.key === "Escape") {
								event.preventDefault();
								close();
								return;
							}
							if (keymatch(event.nativeEvent, "CmdOrCtrl+Enter")) {
								event.preventDefault();
								editor.commands.replaceAllFindMatches(replacement);
								return;
							}
							if (event.key !== "Enter") return;
							event.preventDefault();
							replaceCurrent();
						}}
						placeholder="Replace with..."
						className="col-start-2 col-end-4 h-7 min-w-0 border-0 bg-transparent text-[11px] text-foreground outline-hidden placeholder:text-muted-foreground"
					/>
					<div className="col-start-2 col-end-4 flex items-center justify-end gap-1 pr-1 pb-1">
						<Button
							variant="ghost"
							size="sm"
							aria-label="Replace all matches"
							title={`Replace all matches (${formatShortcut("CmdOrCtrl+Enter")})`}
							disabled={matchCount === 0}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => editor.commands.replaceAllFindMatches(replacement)}
						>
							Replace all
						</Button>
						<Button
							size="sm"
							aria-label="Replace current match"
							title={`Replace current match (${formatShortcut("Enter")})`}
							disabled={matchCount === 0}
							onMouseDown={(event) => event.preventDefault()}
							onClick={replaceCurrent}
						>
							Replace
							<MingcuteCornerDownLeftLine data-icon="inline-end" />
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

function FindButton({
	children,
	disabled,
	label,
	onClick,
	shortcut,
}: {
	children: ReactNode;
	disabled?: boolean;
	label: string;
	onClick: () => void;
	shortcut?: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={shortcut ? `${label} (${formatShortcut(shortcut)})` : label}
			disabled={disabled}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className={cn(
				"inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-inner)] text-muted-foreground outline-hidden transition-[background-color,color,box-shadow] duration-[var(--default-transition-duration)] ease-snappy hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40",
				"disabled:pointer-events-none disabled:opacity-40",
			)}
		>
			{children}
		</button>
	);
}
