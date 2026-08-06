import { Select } from "@base-ui/react/select";
import { getCaretFormattingState } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import MingcuteBoldLine from "~icons/mingcute/bold-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteItalicLine from "~icons/mingcute/italic-line";
import MingcuteLinkLine from "~icons/mingcute/link-line";
import MingcuteStrikethroughLine from "~icons/mingcute/strikethrough-line";
import { shouldShowFooterDivider } from "../lib/scrollOverflow";
import { Button } from "../primitives/button";

type CountMode = "words" | "chars";

type CountState = {
	wordCount: number;
	charCount: number;
	isSelectionCount: boolean;
};

type PaletteState = CountState & {
	activeMarkNames: string[];
	canEscapeBoundary: boolean;
	showDashedDivider: boolean;
};

export type SpellcheckControls = {
	enabled: boolean;
	language: string;
	availableLanguages: string[];
	onChange: (language: string | null) => void;
};

const SPELLCHECK_OFF = "__off__";

export function FormattingStatusBar({
	editor,
	scrollContainer,
	spellcheck,
}: {
	editor: Editor | null;
	scrollContainer: HTMLDivElement | null;
	spellcheck?: SpellcheckControls | null;
}) {
	const [countMode, setCountMode] = useState<CountMode>("words");
	const [paletteState, setPaletteState] = useState<PaletteState>({
		wordCount: 0,
		charCount: 0,
		isSelectionCount: false,
		activeMarkNames: [],
		canEscapeBoundary: false,
		showDashedDivider: false,
	});

	useEffect(() => {
		if (!editor) return;
		const resolvedScrollContainer =
			scrollContainer ??
			(editor.view.dom.closest(".editorViewport") as HTMLDivElement | null) ??
			null;

		const update = () => {
			const counts = getFormattingStatusCounts(editor);
			const { state } = editor;
			const showDashedDivider = shouldShowFooterDivider(
				resolvedScrollContainer,
			);
			if (!editor.isFocused || !state.selection.empty) {
				setPaletteState({
					...counts,
					activeMarkNames: [],
					canEscapeBoundary: false,
					showDashedDivider,
				});
				return;
			}

			const caretState = getCaretFormattingState(state);
			setPaletteState({
				...counts,
				activeMarkNames: caretState.activeMarkNames,
				canEscapeBoundary: caretState.canEscapeBoundary,
				showDashedDivider,
			});
		};

		update();
		requestAnimationFrame(update);
		editor.on("selectionUpdate", update);
		editor.on("transaction", update);
		editor.on("focus", update);
		editor.on("blur", update);
		resolvedScrollContainer?.addEventListener("scroll", update, {
			passive: true,
		});
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);

		return () => {
			editor.off("selectionUpdate", update);
			editor.off("transaction", update);
			editor.off("focus", update);
			editor.off("blur", update);
			resolvedScrollContainer?.removeEventListener("scroll", update);
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	}, [editor, scrollContainer]);
	if (!editor) return null;
	const dividerClass = paletteState.showDashedDivider
		? "[border-block-start:1px_dashed_var(--border)]"
		: "border-transparent";

	return (
		<div
			className={`z-[3] flex h-8 items-center justify-between bg-background/95 px-2 text-xs backdrop-blur-[2px] ${dividerClass}`}
		>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="xs"
					className="text-muted-foreground"
					title={
						countMode === "words" ? "Show character count" : "Show word count"
					}
					onClick={() =>
						setCountMode((m) => (m === "words" ? "chars" : "words"))
					}
				>
					{formatCountLabel(countMode, paletteState)}
				</Button>
				{spellcheck && <SpellcheckLabel spellcheck={spellcheck} />}
			</div>
			<div className="flex items-center gap-2 text-muted-foreground">
				{paletteState.canEscapeBoundary && (
					<span className="inline-flex h-4 items-center rounded-sm border border-border bg-secondary px-1 text-[11px] leading-none text-foreground shadow-overlay">
						esc
					</span>
				)}
				{paletteState.activeMarkNames.includes("bold") && (
					<MingcuteBoldLine className="size-4" />
				)}
				{paletteState.activeMarkNames.includes("italic") && (
					<MingcuteItalicLine className="size-4" />
				)}
				{paletteState.activeMarkNames.includes("strike") && (
					<MingcuteStrikethroughLine className="size-4" />
				)}
				{paletteState.activeMarkNames.includes("link") && (
					<MingcuteLinkLine className="size-4" />
				)}
			</div>
		</div>
	);
}

function getFormattingStatusCounts(editor: Editor): CountState {
	const { state } = editor;
	const isSelectionCount = editor.isFocused && !state.selection.empty;
	const text = isSelectionCount
		? state.doc.textBetween(state.selection.from, state.selection.to, " ")
		: editor.getText();

	return {
		wordCount: countWords(text),
		charCount: text.length,
		isSelectionCount,
	};
}

function formatCountLabel(mode: CountMode, counts: CountState) {
	const suffix = counts.isSelectionCount ? " selected" : "";
	return mode === "words"
		? `${counts.wordCount} words${suffix}`
		: `${counts.charCount} characters${suffix}`;
}

function countWords(text: string) {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\s+/).length;
}

function SpellcheckLabel({ spellcheck }: { spellcheck: SpellcheckControls }) {
	const { enabled, language, availableLanguages, onChange } = spellcheck;
	const selectValue = enabled ? language : SPELLCHECK_OFF;

	return (
		<Select.Root
			value={selectValue}
			onValueChange={(value) => {
				if (value === null || value === SPELLCHECK_OFF) {
					onChange(null);
				} else {
					onChange(value);
				}
			}}
		>
			<Select.Trigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="xs"
						className="text-muted-foreground"
						aria-label="Spellcheck language"
						title="Spellcheck language"
					/>
				}
			>
				<Select.Value>
					<span className="inline-flex items-center gap-1">
						<MingcuteCheckLine className="size-3.5" />
						{enabled ? language : "Off"}
					</span>
				</Select.Value>
			</Select.Trigger>
			<Select.Portal>
				<Select.Positioner
					align="start"
					side="top"
					sideOffset={8}
					className="isolate z-50"
				>
					<Select.Popup className="z-50 max-h-64 w-44 origin-(--transform-origin) overflow-y-auto rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						<Select.Item
							value={SPELLCHECK_OFF}
							className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-start text-[11px] text-foreground outline-hidden select-none data-highlighted:bg-accent"
						>
							<Select.ItemIndicator className="inline-flex" keepMounted>
								<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
							</Select.ItemIndicator>
							<Select.ItemText>Off</Select.ItemText>
						</Select.Item>
						{availableLanguages.map((code) => (
							<Select.Item
								key={code}
								value={code}
								className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-start text-[11px] text-foreground outline-hidden select-none data-highlighted:bg-accent"
							>
								<Select.ItemIndicator className="inline-flex" keepMounted>
									<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
								</Select.ItemIndicator>
								<Select.ItemText>{code}</Select.ItemText>
							</Select.Item>
						))}
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}
