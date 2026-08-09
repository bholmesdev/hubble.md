import {
	computePosition,
	flip,
	offset,
	shift,
	type VirtualElement,
} from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { keymatch } from "keymatch";
import {
	type ComponentType,
	type CSSProperties,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import MingcuteBoldLine from "~icons/mingcute/bold-line";
import MingcuteChat3Line from "~icons/mingcute/chat-3-line";
import MingcuteHeading1Line from "~icons/mingcute/heading-1-line";
import MingcuteHeading2Line from "~icons/mingcute/heading-2-line";
import MingcuteHeading3Line from "~icons/mingcute/heading-3-line";
import MingcuteItalicLine from "~icons/mingcute/italic-line";
import MingcuteLinkLine from "~icons/mingcute/link-line";
import MingcuteListCheck2Line from "~icons/mingcute/list-check-2-line";
import MingcuteListCheckLine from "~icons/mingcute/list-check-line";
import MingcuteListOrderedLine from "~icons/mingcute/list-ordered-line";
import MingcuteMore1Line from "~icons/mingcute/more-1-line";
import MingcuteQuoteLeftLine from "~icons/mingcute/quote-left-line";
import MingcuteStrikethroughLine from "~icons/mingcute/strikethrough-line";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { Separator } from "../primitives/separator";
import { OPEN_FORMAT_COMMAND_MENU_EVENT } from "./FormatCommandMenu";
import {
	applyFormatCommand,
	type FormatCommandKind,
	isFormatActive,
} from "./formatCommands";

type ToolbarPosition = {
	x: number;
	y: number;
};

type ToolbarAction = {
	kind: FormatCommandKind | "comment";
	label: string;
	shortcut?: string;
	icon: ComponentType<{ className?: string }>;
};

// Keyboard-driven selections (shift+arrow) debounce before revealing so the
// toolbar does not flicker in while the selection is still growing.
const KEYBOARD_SHOW_DELAY_MS = 150;

// Inline marks and block styles surfaced directly on the toolbar. Less common
// commands (divider, plain text) stay in the `Cmd+/` menu behind "More".
const INLINE_ACTIONS: ToolbarAction[] = [
	{ kind: "bold", label: "Bold", shortcut: "⌘B", icon: MingcuteBoldLine },
	{ kind: "italic", label: "Italic", shortcut: "⌘I", icon: MingcuteItalicLine },
	{
		kind: "strike",
		label: "Strikethrough",
		shortcut: "⌘⇧X",
		icon: MingcuteStrikethroughLine,
	},
	{ kind: "link", label: "Link", shortcut: "⌘K", icon: MingcuteLinkLine },
];

const HEADING_ACTIONS: ToolbarAction[] = [
	{
		kind: "heading1",
		label: "Heading 1",
		shortcut: "⌘⌥1",
		icon: MingcuteHeading1Line,
	},
	{
		kind: "heading2",
		label: "Heading 2",
		shortcut: "⌘⌥2",
		icon: MingcuteHeading2Line,
	},
	{
		kind: "heading3",
		label: "Heading 3",
		shortcut: "⌘⌥3",
		icon: MingcuteHeading3Line,
	},
];

const BLOCK_ACTIONS: ToolbarAction[] = [
	{
		kind: "bulletList",
		label: "Bulleted list",
		shortcut: "⌘⇧8",
		icon: MingcuteListCheckLine,
	},
	{
		kind: "orderedList",
		label: "Numbered list",
		shortcut: "⌘⇧7",
		icon: MingcuteListOrderedLine,
	},
	{
		kind: "taskList",
		label: "To-do list",
		shortcut: "⌘⇧9",
		icon: MingcuteListCheck2Line,
	},
	{
		kind: "blockquote",
		label: "Quote",
		shortcut: "⌘⇧B",
		icon: MingcuteQuoteLeftLine,
	},
];

const COMMENT_ACTION: ToolbarAction = {
	kind: "comment",
	label: "Comment",
	icon: MingcuteChat3Line,
};
const ACTION_GROUPS = [INLINE_ACTIONS, HEADING_ACTIONS, BLOCK_ACTIONS] as const;
const TOOLBAR_EDGE_GAP = 16;
const TOOLBAR_FRAME_WIDTH = 10;
const TOOLBAR_BUTTON_WIDTH = 28;
const TOOLBAR_GAP_WIDTH = 2;
const TOOLBAR_SEPARATOR_WIDTH = 5;

type ActionGroups = readonly (readonly ToolbarAction[])[];

// The bar floats, so it never shrinks on its own. Keep Comment in place and
// drop formatting actions from the right until the bar fits.
function fittingGroups(width: number, hasComment: boolean): ActionGroups {
	for (let count = countActions(ACTION_GROUPS); count >= 0; count -= 1) {
		const shown = [
			...takeActions(ACTION_GROUPS, count),
			...(hasComment ? [[COMMENT_ACTION]] : []),
		];
		if (toolbarWidth(shown) <= width - TOOLBAR_EDGE_GAP) return shown;
	}
	return [];
}

function takeActions(groups: ActionGroups, count: number): ActionGroups {
	let left = count;
	return groups
		.map((group) => {
			const shown = group.slice(0, left);
			left -= shown.length;
			return shown;
		})
		.filter((group) => group.length > 0);
}

// Must track the render below, including the trailing "More" button.
function toolbarWidth(groups: ActionGroups) {
	const actions = countActions(groups);
	if (actions === 0) return TOOLBAR_FRAME_WIDTH + TOOLBAR_BUTTON_WIDTH;
	const elements = actions + groups.length + 1;
	return (
		TOOLBAR_FRAME_WIDTH +
		TOOLBAR_BUTTON_WIDTH * (actions + 1) +
		TOOLBAR_SEPARATOR_WIDTH * groups.length +
		TOOLBAR_GAP_WIDTH * (elements - 1)
	);
}

function countActions(groups: ActionGroups) {
	return groups.reduce((sum, group) => sum + group.length, 0);
}

function shouldShowToolbar(editor: Editor) {
	const { selection } = editor.state;
	if (!editor.isFocused) return false;
	if (selection.empty) return false;
	// Only plain text ranges are formattable; skip node selections (e.g. images)
	// and code blocks, where Markdown formatting does not apply.
	if (!(selection instanceof TextSelection)) return false;
	if (editor.isActive("codeBlock")) return false;
	return true;
}

/**
 * Floating formatting toolbar shown when text is selected. It is a
 * discoverability layer over the existing editor commands shared with the
 * `Cmd+/` format command menu, so it keeps emitting normal Markdown.
 */
export function SelectionFormattingToolbar({
	editor,
	viewport,
	onComment,
}: {
	editor: Editor | null;
	viewport: HTMLDivElement | null;
	onComment?: () => void;
}) {
	const [position, setPosition] = useState<ToolbarPosition | null>(null);
	// Scale from the edge facing the selection, like Base UI popups do via
	// their --transform-origin variable.
	const [transformOrigin, setTransformOrigin] = useState("center bottom");
	// `open` drives the enter/exit animation; `present` keeps the toolbar
	// rendered until the exit animation finishes.
	const [open, setOpen] = useState(false);
	const [present, setPresent] = useState(false);
	// Active marks/blocks are derived from editor state during render. Bump a
	// revision on every relevant change so the button highlights stay current
	// even when the toolbar's position does not move.
	const [, setRevision] = useState(0);
	const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
	// Show everything until the viewport has been measured.
	const [viewportWidth, setViewportWidth] = useState(Number.POSITIVE_INFINITY);
	const shownGroups = fittingGroups(viewportWidth, Boolean(onComment));
	const openRef = useRef(false);

	useLayoutEffect(() => {
		if (!viewport) return;
		const measure = () => {
			if (viewport.clientWidth > 0) setViewportWidth(viewport.clientWidth);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [viewport]);

	useEffect(() => {
		if (!editor) return;
		let pointerDown = false;
		let showTimer: number | null = null;
		let pointerUpTimer: number | null = null;
		// Escape dismisses the toolbar for the current selection only; any new
		// or modified selection clears the dismissal.
		let dismissedSelectionKey: string | null = null;

		const selectionKey = () => {
			const { from, to } = editor.state.selection;
			return `${from}:${to}`;
		};

		const clearShowTimer = () => {
			if (showTimer === null) return;
			window.clearTimeout(showTimer);
			showTimer = null;
		};

		const positionToolbar = () => {
			if (!viewport || !toolbarEl) return;

			const reference: VirtualElement = {
				contextElement: viewport,
				getBoundingClientRect() {
					const { from, to } = editor.state.selection;
					const start = editor.view.coordsAtPos(from);
					const end = editor.view.coordsAtPos(to);
					const left = Math.min(start.left, end.left);
					const right = Math.max(start.right, end.right);
					const top = Math.min(start.top, end.top);
					const bottom = Math.max(start.bottom, end.bottom);
					return {
						x: left,
						y: top,
						left,
						top,
						right,
						bottom,
						width: right - left,
						height: bottom - top,
						toJSON() {
							// Floating UI expects a plain DOMRect snapshot; returning `this`
							// leaks the mutable reference and violates compiler purity.
							return {
								x: left,
								y: top,
								left,
								top,
								right,
								bottom,
								width: right - left,
								height: bottom - top,
							};
						},
					};
				},
			};

			void computePosition(reference, toolbarEl, {
				strategy: "absolute",
				placement: "top",
				middleware: [
					offset(8),
					flip({
						boundary: viewport,
						fallbackPlacements: ["bottom"],
						padding: 8,
					}),
					shift({ boundary: viewport, padding: 8 }),
				],
			}).then(({ x, y, placement }) => {
				setPosition({ x, y });
				setTransformOrigin(
					placement === "bottom" ? "center top" : "center bottom",
				);
			});
		};

		const show = () => {
			clearShowTimer();
			openRef.current = true;
			setOpen(true);
			setPresent(true);
			setRevision((value) => value + 1);
			positionToolbar();
		};

		const hide = () => {
			clearShowTimer();
			openRef.current = false;
			setOpen(false);
		};

		const update = (immediate = false) => {
			if (
				dismissedSelectionKey !== null &&
				dismissedSelectionKey !== selectionKey()
			) {
				dismissedSelectionKey = null;
			}
			// Stay hidden while the pointer is down so the toolbar never covers
			// text mid-drag; it reappears on pointerup once the selection is set.
			if (
				pointerDown ||
				dismissedSelectionKey !== null ||
				!shouldShowToolbar(editor)
			) {
				hide();
				return;
			}
			if (openRef.current) {
				setRevision((value) => value + 1);
				positionToolbar();
				return;
			}
			if (immediate) {
				show();
				return;
			}
			clearShowTimer();
			showTimer = window.setTimeout(() => {
				showTimer = null;
				update(true);
			}, KEYBOARD_SHOW_DELAY_MS);
		};

		const handleUpdate = () => update();
		const handlePointerDown = () => {
			pointerDown = true;
			hide();
		};
		const handlePointerUp = () => {
			if (!pointerDown) return;
			pointerDown = false;
			// ProseMirror applies click selections on mouseup, which fires after
			// pointerup. Defer so we evaluate the final selection instead of
			// briefly re-showing the toolbar for the stale one.
			if (pointerUpTimer !== null) window.clearTimeout(pointerUpTimer);
			pointerUpTimer = window.setTimeout(() => {
				pointerUpTimer = null;
				update(true);
			}, 0);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!keymatch(event, "Escape")) return;
			// Someone else (link popover, format menu) consumed this Escape.
			if (event.defaultPrevented) return;
			if (!openRef.current && showTimer === null) return;
			// Dismiss the bar without touching the text selection, and without
			// preventing default so other Escape handling still runs.
			dismissedSelectionKey = selectionKey();
			hide();
		};

		update();
		const editorDom = editor.view.dom;
		editor.on("selectionUpdate", handleUpdate);
		editor.on("transaction", handleUpdate);
		editor.on("focus", handleUpdate);
		editor.on("blur", handleUpdate);
		editorDom.addEventListener("pointerdown", handlePointerDown);
		// The drag can end outside the editor, so listen on window.
		window.addEventListener("pointerup", handlePointerUp);
		editorDom.addEventListener("keydown", handleKeyDown, true);
		viewport?.addEventListener("scroll", handleUpdate, { passive: true });
		window.addEventListener("resize", handleUpdate);

		return () => {
			clearShowTimer();
			if (pointerUpTimer !== null) window.clearTimeout(pointerUpTimer);
			editor.off("selectionUpdate", handleUpdate);
			editor.off("transaction", handleUpdate);
			editor.off("focus", handleUpdate);
			editor.off("blur", handleUpdate);
			editorDom.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("pointerup", handlePointerUp);
			editorDom.removeEventListener("keydown", handleKeyDown, true);
			viewport?.removeEventListener("scroll", handleUpdate);
			window.removeEventListener("resize", handleUpdate);
		};
	}, [editor, viewport, toolbarEl]);

	if (!editor) return null;

	return (
		<div
			ref={setToolbarEl}
			role="toolbar"
			aria-label="Text formatting"
			aria-hidden={!open}
			data-open={open ? "" : undefined}
			data-closed={!open && present ? "" : undefined}
			// Same enter/exit treatment as the dropdown popups (see Sidebar's
			// Menu.Popup / Select.Popup classes). fill-mode-forwards keeps the
			// exit's final frame (opacity 0) applied until React unmounts the
			// bar, so it never flashes back to visible after animating out.
			className="absolute z-4 flex max-w-[calc(100%-1rem)] origin-(--transform-origin) items-center gap-0.5 overflow-hidden rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-popover-foreground shadow-overlay transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:fill-mode-forwards"
			style={
				{
					insetInlineStart: `${position?.x ?? 0}px`,
					insetBlockStart: `${position?.y ?? 0}px`,
					visibility: present && position ? "visible" : "hidden",
					pointerEvents: open ? "auto" : "none",
					"--transform-origin": transformOrigin,
				} as CSSProperties
			}
			onAnimationEnd={(event) => {
				// Only the exit animation ending retires the bar; an enter
				// animation finishing right after a hide/show flip must not.
				if (event.target !== event.currentTarget) return;
				if (event.animationName !== "exit") return;
				if (!openRef.current) setPresent(false);
			}}
		>
			{shownGroups.map((group, groupIndex) => (
				<div key={group[0].kind} className="contents">
					{groupIndex > 0 && (
						<Separator orientation="vertical" className="mx-0.5" />
					)}
					{group.map((action) => (
						<ToolbarButton
							key={action.kind}
							editor={editor}
							action={action}
							onComment={onComment}
						/>
					))}
				</div>
			))}
			{shownGroups.length > 0 && (
				<Separator orientation="vertical" className="mx-0.5" />
			)}
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="More formatting"
				title="More formatting (⌘/)"
				className="text-muted-foreground"
				onMouseDown={(event) => event.preventDefault()}
				onClick={() =>
					window.dispatchEvent(new CustomEvent(OPEN_FORMAT_COMMAND_MENU_EVENT))
				}
			>
				<MingcuteMore1Line className="size-4" />
			</Button>
		</div>
	);
}

function ToolbarButton({
	editor,
	action,
	onComment,
}: {
	editor: Editor;
	action: ToolbarAction;
	onComment?: () => void;
}) {
	const Icon = action.icon;
	const active =
		action.kind !== "comment" && isFormatActive(editor, action.kind);
	const title = action.shortcut
		? `${action.label} (${action.shortcut})`
		: action.label;
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={action.label}
			aria-pressed={action.kind === "comment" ? undefined : active}
			title={title}
			className={cn(
				"text-muted-foreground",
				active && "bg-muted text-foreground",
			)}
			// Keep the editor selection intact when pressing a toolbar button.
			onMouseDown={(event) => event.preventDefault()}
			onClick={() =>
				action.kind === "comment"
					? onComment?.()
					: applyFormatCommand(editor, action.kind)
			}
		>
			<Icon className="size-4" />
		</Button>
	);
}
