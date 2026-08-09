import type { Editor } from "@tiptap/core";
import {
	type CSSProperties,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useState,
} from "react";
import MingcuteChat3Line from "~icons/mingcute/chat-3-line";
import { cn } from "../lib/utils";
import type { ReviewComment } from "./reviewComments";

type AnchorRange = { from: number; to: number };

// How far the hover zone reaches back into the text. Its outer edge is the
// viewport edge, so the whole margin counts as gutter.
const HOVER_TEXT_BUFFER_PX = 96;
const CONTROL_SIZE_PX = 20;

/** Runs `onChange` whenever live layout moves, for anything positioned from
 * measured DOM. Dragging a splitter resizes the viewport through CSS alone
 * without firing a window resize, so the element is observed too. */
export function useLayoutChange(
	viewportRef: RefObject<HTMLDivElement | null>,
	onChange: () => void,
) {
	useEffect(() => {
		const viewport = viewportRef.current;
		viewport?.addEventListener("scroll", onChange, { passive: true });
		window.addEventListener("resize", onChange);
		const observer = viewport ? new ResizeObserver(onChange) : null;
		if (viewport) observer?.observe(viewport);
		return () => {
			viewport?.removeEventListener("scroll", onChange);
			window.removeEventListener("resize", onChange);
			observer?.disconnect();
		};
	}, [onChange, viewportRef]);
}

/** The always-on affordances beside the text column: a badge per commented
 * line, and an add button on whichever block the pointer is near. */
export function ReviewCommentGutter({
	editor,
	viewportRef,
	comments,
	popoverOpen,
	onOpenThread,
	onAddComment,
}: {
	editor: Editor;
	viewportRef: RefObject<HTMLDivElement | null>;
	comments: ReviewComment[];
	popoverOpen: boolean;
	onOpenThread: (comment: ReviewComment) => void;
	onAddComment: (range: AnchorRange) => void;
}) {
	const [hoveredBlock, setHoveredBlock] = useState<AnchorRange | null>(null);
	const [layout, setLayout] = useState<GutterLayout>(EMPTY_LAYOUT);

	// Measured from live DOM after layout, not during render: badge positions
	// come from where the text actually landed.
	const remeasure = () => {
		setLayout(
			measureGutter({
				editor,
				viewport: viewportRef.current,
				comments,
				hoveredBlock: popoverOpen ? null : hoveredBlock,
			}),
		);
	};

	// Reserve gutter space so badges never sit on top of text, then remeasure
	// before paint so positions reflect the reflow. Keyed on comment count only:
	// toggling this per hover would reflow text mid-hover and cause jitter.
	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const hasComments = comments.length > 0;
		const changed = viewport.hasAttribute("data-review-gutter") !== hasComments;
		viewport.toggleAttribute("data-review-gutter", hasComments);
		if (changed) {
			void viewport.offsetHeight;
			remeasure();
		}
		return () => viewport.removeAttribute("data-review-gutter");
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	}, [comments.length, remeasure, viewportRef]);

	useEffect(() => {
		if (popoverOpen) setHoveredBlock(null);
	}, [popoverOpen]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const clearHover = () => setHoveredBlock(null);
		const updateHover = (event: MouseEvent) => {
			if (popoverOpen || !editor.state.selection.empty) {
				clearHover();
				return;
			}
			const contentRect = editor.view.dom.getBoundingClientRect();
			if (
				event.clientY < contentRect.top ||
				event.clientY > contentRect.bottom
			) {
				clearHover();
				return;
			}
			// Trigger near the gutter only. A full-line zone flickers as the
			// pointer crosses the text/button boundary and fights normal text
			// hovering. The zone runs out to the viewport edge so there is no
			// dead patch between the text and the button.
			const viewportRect = viewport.getBoundingClientRect();
			const paddingInlineEnd =
				Number.parseFloat(getComputedStyle(editor.view.dom).paddingInlineEnd) ||
				0;
			const textInlineEnd = contentRect.right - paddingInlineEnd;
			if (
				event.clientX < textInlineEnd - HOVER_TEXT_BUFFER_PX ||
				event.clientX > viewportRect.right
			) {
				clearHover();
				return;
			}
			const coords = editor.view.posAtCoords({
				// Probe just inside the text box. ProseMirror cannot resolve a
				// document position from the editor element's inline padding.
				left: Math.min(event.clientX, textInlineEnd - 1),
				top: event.clientY,
			});
			if (!coords) {
				clearHover();
				return;
			}
			const range = textblockRangeAt(editor, coords.pos);
			setHoveredBlock((current) =>
				range && current?.from === range.from && current?.to === range.to
					? current
					: range,
			);
		};
		viewport.addEventListener("mousemove", updateHover);
		viewport.addEventListener("mouseleave", clearHover);
		viewport.addEventListener("scroll", clearHover, { passive: true });
		return () => {
			viewport.removeEventListener("mousemove", updateHover);
			viewport.removeEventListener("mouseleave", clearHover);
			viewport.removeEventListener("scroll", clearHover);
		};
	}, [editor, popoverOpen, viewportRef]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	useLayoutEffect(remeasure, [remeasure]);
	useLayoutChange(viewportRef, remeasure);

	// Held so the add button fades out from its last position instead of
	// vanishing the moment the pointer leaves.
	const [restingTop, setRestingTop] = useState<number | null>(null);
	useEffect(() => {
		if (layout.hoverTop !== null) setRestingTop(layout.hoverTop);
	}, [layout.hoverTop]);
	const hoverTop = layout.hoverTop ?? restingTop;

	return (
		<div className="pointer-events-none absolute inset-0 z-3">
			{layout.badges.map((badge) => (
				<button
					key={`${badge.comment.id}:${badge.comment.from}`}
					type="button"
					aria-label={`Open comment ${badge.comment.id}`}
					data-review-comment-anchor
					title={badge.resolved ? "Resolved comment" : "Open comments"}
					className={cn(
						"pointer-events-auto absolute flex h-5 items-center gap-1 rounded-md px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
						badge.resolved && "opacity-50",
					)}
					style={
						{
							insetInlineEnd: `${layout.inlineEnd}px`,
							insetBlockStart: `${badge.blockStart}px`,
						} satisfies CSSProperties
					}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onOpenThread(badge.comment)}
				>
					<MingcuteChat3Line className="size-3.5" />
					{badge.count}
				</button>
			))}
			{hoverTop !== null && (
				<button
					type="button"
					aria-label="Add comment"
					data-review-comment-anchor
					title="Add comment"
					className={cn(
						"absolute flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground",
						layout.hoverTop !== null
							? "pointer-events-auto opacity-100"
							: "pointer-events-none",
					)}
					style={
						{
							insetInlineEnd: `${layout.inlineEnd}px`,
							insetBlockStart: `${hoverTop}px`,
						} satisfies CSSProperties
					}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => hoveredBlock && onAddComment(hoveredBlock)}
				>
					<MingcuteChat3Line className="size-3.5" />
				</button>
			)}
		</div>
	);
}

type GutterLayout = {
	badges: GutterBadge[];
	inlineEnd: number;
	hoverTop: number | null;
};

const EMPTY_LAYOUT: GutterLayout = { badges: [], inlineEnd: 0, hoverTop: null };

type GutterBadge = {
	comment: ReviewComment;
	count: number;
	resolved: boolean;
	blockStart: number;
};

/** Comments sharing a line collapse into one badge whose count totals that
 * line's thread messages. Positions come from live layout, so this reruns
 * whenever the revision says the viewport moved. */
function measureGutter({
	editor,
	viewport,
	comments,
	hoveredBlock,
}: {
	editor: Editor;
	viewport: HTMLDivElement | null;
	comments: ReviewComment[];
	hoveredBlock: AnchorRange | null;
}): GutterLayout {
	if (!viewport) return EMPTY_LAYOUT;

	const viewportRect = viewport.getBoundingClientRect();
	const contentEl = editor.view.dom;
	// Right-align badges just inside the content column's end padding so they
	// stay visible even when the window is narrower than the column.
	const inlineEnd =
		viewport.clientWidth -
		(contentEl.getBoundingClientRect().right -
			viewportRect.left +
			viewport.scrollLeft) +
		4;

	const topAt = (pos: number) => {
		const coords = editor.view.coordsAtPos(pos);
		return {
			lineKey: Math.round(coords.top),
			top:
				coords.top -
				viewportRect.top +
				viewport.scrollTop +
				(coords.bottom - coords.top - CONTROL_SIZE_PX) / 2,
		};
	};

	const byLine = new Map<number, GutterBadge>();
	for (const comment of comments) {
		const { lineKey, top } = topAt(comment.from);
		const count = 1 + (comment.attrs.replies?.length ?? 0);
		const existing = byLine.get(lineKey);
		if (existing) {
			existing.count += count;
			existing.resolved = existing.resolved && comment.attrs.resolved === true;
			continue;
		}
		byLine.set(lineKey, {
			comment,
			count,
			resolved: comment.attrs.resolved === true,
			blockStart: top,
		});
	}

	let hoverTop: number | null = null;
	if (hoveredBlock) {
		const { lineKey, top } = topAt(hoveredBlock.from);
		// A block that already has a badge on its first line keeps just that one
		// gutter affordance instead of stacking a second icon.
		if (!byLine.has(lineKey)) hoverTop = top;
	}

	return { badges: [...byLine.values()], inlineEnd, hoverTop };
}

/** The innermost textblock containing `pos`, for anchoring the add button to
 * the whole block. Code blocks are excluded: CriticMarkup wrapping their
 * content would corrupt the code (see docs/review-comments.md). */
function textblockRangeAt(editor: Editor, pos: number): AnchorRange | null {
	const $pos = editor.state.doc.resolve(pos);
	for (let depth = $pos.depth; depth >= 0; depth -= 1) {
		const node = $pos.node(depth);
		if (!node.isTextblock) continue;
		if (node.type.name === "codeBlock") return null;
		return { from: $pos.start(depth), to: $pos.end(depth) };
	}
	return null;
}
