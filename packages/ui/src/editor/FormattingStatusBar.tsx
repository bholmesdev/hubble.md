import { Menu } from "@base-ui/react/menu";
import { getCaretFormattingState } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import MingcuteBoldLine from "~icons/mingcute/bold-line";
import MingcuteItalicLine from "~icons/mingcute/italic-line";
import MingcuteLinkLine from "~icons/mingcute/link-line";
import MingcuteStrikethroughLine from "~icons/mingcute/strikethrough-line";
import { shouldShowFooterDivider } from "../lib/scrollOverflow";
import { Button } from "../primitives/button";
import type { SpellcheckControl } from "./EditorView";

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

export function FormattingStatusBar({
	editor,
	scrollContainer,
	spellcheck,
}: {
	editor: Editor | null;
	scrollContainer: HTMLDivElement | null;
	spellcheck?: SpellcheckControl;
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
			className={`z-[3] flex h-8 items-center justify-between bg-background/95 px-2 text-[12px] backdrop-blur-[2px] ${dividerClass}`}
		>
			<div className="flex items-center">
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
				{spellcheck && <SpellcheckMenu control={spellcheck} />}
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

function SpellcheckMenu({ control }: { control: SpellcheckControl }) {
	return (
		<Menu.Root>
			<Menu.Trigger
				className="cursor-pointer rounded-sm px-2 py-1 text-muted-foreground hover:bg-muted"
				title="Change spellcheck language"
			>
				{control.enabled && control.language
					? formatLanguageName(control.language)
					: "Spellcheck off"}
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner
					align="start"
					side="top"
					sideOffset={4}
					className="isolate z-50"
				>
					<Menu.Popup className="z-50 max-h-72 w-52 overflow-y-auto rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden">
						<Menu.Item
							className={menuItemClass}
							onClick={() => control.onChange(false, control.language)}
						>
							<span className="w-3">{control.enabled ? "" : "✓"}</span>
							Disable spellcheck
						</Menu.Item>
						<Menu.Separator className="my-1 h-px bg-border" />
						{control.availableLanguages.map((language) => (
							<Menu.Item
								key={language}
								className={menuItemClass}
								onClick={() => control.onChange(true, language)}
							>
								<span className="w-3">
									{control.enabled && control.language === language ? "✓" : ""}
								</span>
								{formatLanguageName(language)}
							</Menu.Item>
						))}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

const menuItemClass =
	"flex w-full cursor-pointer items-center gap-1 rounded-sm px-2 py-1.5 outline-hidden select-none data-highlighted:bg-accent";

function formatLanguageName(language: string) {
	try {
		return (
			new Intl.DisplayNames(undefined, { type: "language" }).of(language) ??
			language
		);
	} catch {
		return language;
	}
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
