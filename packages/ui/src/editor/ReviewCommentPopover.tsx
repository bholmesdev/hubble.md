import {
	computePosition,
	flip,
	offset,
	shift,
	size,
	type VirtualElement,
} from "@floating-ui/dom";
import type { ReviewMarkAttrs, ReviewReply } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import {
	type CSSProperties,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import MingcuteArrowUpLine from "~icons/mingcute/arrow-up-line";
import MingcuteChat3Line from "~icons/mingcute/chat-3-line";
import MingcuteCheckCircleFill from "~icons/mingcute/check-circle-fill";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteDelete2Line from "~icons/mingcute/delete-2-line";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import {
	buildReviewAgentPrompt,
	deleteComment,
	type ReviewComment,
	setCommentResolved,
	updateComment,
} from "./reviewComments";

type AnchorRange = { from: number; to: number };
type PopoverMode = "new" | "thread";

// How far the gutter hover zone reaches back into the text. Its outer edge is
// the viewport edge, so the whole margin counts as gutter.
const GUTTER_HOVER_TEXT_BUFFER_PX = 96;

function formatRelativeTime(iso: string | undefined) {
	if (!iso) return null;
	const timestamp = new Date(iso).getTime();
	if (Number.isNaN(timestamp)) return null;
	const elapsed = Date.now() - timestamp;
	if (elapsed < 60_000) return "Just now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
	if (elapsed < 7 * 86_400_000)
		return `${Math.floor(elapsed / 86_400_000)}d ago`;
	return new Date(timestamp).toLocaleDateString();
}

function authorLabel(author: "human" | "agent" | undefined) {
	return author === "agent" ? "Agent" : "You";
}

/** Input and send button share one line while the text fits; once it wraps,
 * the input takes the full width and the button drops to its own row. */
function CommentComposer({
	value,
	onChange,
	onSubmit,
	placeholder,
	ariaLabel,
	inputRef,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	placeholder: string;
	ariaLabel: string;
	inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const measureRef = useRef<HTMLCanvasElement | null>(null);
	const [multiline, setMultiline] = useState(false);

	useLayoutEffect(() => {
		const el = textareaRef.current;
		const form = el?.form;
		const send = form?.querySelector("button");
		if (!el || !form || !send) return;
		// Measure with a canvas rather than the live element, so the answer
		// doesn't depend on the layout currently applied and oscillate.
		measureRef.current ??= document.createElement("canvas");
		const context = measureRef.current.getContext("2d");
		if (!context) return;
		const style = getComputedStyle(el);
		context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const textWidth = Math.max(
			0,
			...value.split("\n").map((line) => context.measureText(line).width),
		);
		const padding =
			(Number.parseFloat(style.paddingInlineStart) || 0) +
			(Number.parseFloat(style.paddingInlineEnd) || 0);
		const available = form.clientWidth - send.offsetWidth - padding - 4;
		setMultiline(value.includes("\n") || textWidth > available);
	}, [value]);

	return (
		<form
			className="flex flex-wrap items-end gap-y-1"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<textarea
				ref={(el) => {
					textareaRef.current = el;
					if (inputRef) inputRef.current = el;
				}}
				rows={1}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (
						event.key === "Enter" &&
						!event.shiftKey &&
						!event.nativeEvent.isComposing
					) {
						event.preventDefault();
						onSubmit();
					}
				}}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className={cn(
					"max-h-40 min-w-36 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1 text-[0.8125rem] leading-relaxed outline-hidden [field-sizing:content] placeholder:text-muted-foreground",
					multiline && "basis-full",
				)}
			/>
			<Button
				type="submit"
				size="icon-xs"
				aria-label={ariaLabel === "Reply text" ? "Send reply" : "Send comment"}
				className="ms-auto rounded-full"
				disabled={!value.trim()}
			>
				<MingcuteArrowUpLine className="size-3.5" />
			</Button>
		</form>
	);
}

function reviewCommentAttrs(mark: Mark) {
	if (mark.type.name !== "reviewMark" || mark.attrs.type !== "reviewComment") {
		return null;
	}
	if (typeof mark.attrs.id !== "string") return null;
	return mark.attrs as ReviewMarkAttrs;
}

function collectComments(editor: Editor): ReviewComment[] {
	const comments: ReviewComment[] = [];
	const lastCommentById = new Map<string, ReviewComment>();
	editor.state.doc.nodesBetween(
		0,
		editor.state.doc.content.size,
		(node, pos) => {
			if (!node.isText) return true;
			const mark = node.marks.find((candidate) =>
				reviewCommentAttrs(candidate),
			);
			if (!mark) return false;
			const attrs = reviewCommentAttrs(mark);
			if (!attrs?.id) return false;
			const existing = lastCommentById.get(attrs.id);
			if (existing?.to === pos) {
				existing.to = pos + node.nodeSize;
				existing.attrs = attrs;
				return false;
			}
			const comment = {
				id: attrs.id,
				from: pos,
				to: pos + node.nodeSize,
				attrs,
			};
			comments.push(comment);
			lastCommentById.set(attrs.id, comment);
			return false;
		},
	);
	return comments;
}

function commentAtPosition(comments: ReviewComment[], position: number) {
	return comments.find(
		(comment) => comment.from <= position && position <= comment.to,
	);
}

/** The innermost textblock containing `pos`, for anchoring the hover "add
 * comment" button to the whole block. Code blocks are excluded: CriticMarkup
 * wrapping their content would corrupt the code (see docs/review-comments.md). */
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

/** All review concepts share one mark type, so commenting over an existing
 * insertion/deletion/replacement/highlight would silently replace it. Refuse
 * instead. An id-less comment mark counts as a conflict too: collectComments
 * can't key on it, so it can't be reopened as an existing thread. */
function findConflictingReviewMark(editor: Editor, range: AnchorRange) {
	let found: string | null = null;
	editor.state.doc.nodesBetween(range.from, range.to, (node) => {
		if (found || !node.isText) return true;
		const mark = node.marks.find((candidate) => {
			if (candidate.type.name !== "reviewMark") return false;
			if (candidate.attrs.type !== "reviewComment") return true;
			return typeof candidate.attrs.id !== "string";
		});
		if (mark) found = mark.attrs.type as string;
		return false;
	});
	return found;
}

// Random rather than sequential: a high-water mark only survives for the
// component's lifetime, so reopening the file could reissue a deleted id and
// let a stale copied agent prompt land on an unrelated thread.
function generateCommentId() {
	const random =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
			: Math.random().toString(36).slice(2, 14);
	return `c${random}`;
}

function nextReplyId(replies: ReviewReply[] | null | undefined) {
	const highest = (replies ?? []).reduce((max, reply) => {
		const value = Number(reply.id.match(/^r(\d+)$/)?.[1] ?? 0);
		return Math.max(max, value);
	}, 0);
	return `r${highest + 1}`;
}

function selectionReference(
	editor: Editor,
	range: AnchorRange,
): VirtualElement {
	return {
		contextElement: editor.view.dom,
		getBoundingClientRect() {
			const start = editor.view.coordsAtPos(range.from);
			const end = editor.view.coordsAtPos(range.to);
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
					return this;
				},
			};
		},
	};
}

export function ReviewCommentPopover({
	editor,
	filePath,
	viewportRef,
	request,
	openRequest,
	onMessage,
	onCommentsChange,
}: {
	editor: Editor | null;
	filePath: string;
	viewportRef: RefObject<HTMLDivElement | null>;
	request: number;
	/** Bumped by the status bar summary to open one thread by id. */
	openRequest?: { id: string; nonce: number };
	onMessage?: (message: string, type: "success" | "error") => void;
	/** Publishes the document's threads so the status bar can summarize them
	 * without walking the document a second time on every transaction. */
	onCommentsChange?: (comments: ReviewComment[]) => void;
}) {
	const [comments, setComments] = useState<ReviewComment[]>([]);
	const [activeComment, setActiveComment] = useState<ReviewComment | null>(
		null,
	);
	const [anchorRange, setAnchorRange] = useState<AnchorRange | null>(null);
	const [mode, setMode] = useState<PopoverMode>("new");
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [replyDraft, setReplyDraft] = useState("");
	const [position, setPosition] = useState({ x: 0, y: 0 });
	const [popoverEl, setPopoverEl] = useState<HTMLDivElement | null>(null);
	const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
	const requestRef = useRef(0);
	const openRequestRef = useRef(0);
	const [layoutRevision, setLayoutRevision] = useState(0);
	const [hoveredBlock, setHoveredBlock] = useState<AnchorRange | null>(null);
	// Kept mounted and faded via opacity rather than conditionally rendered, so
	// the button fades out from its last position instead of vanishing.
	const lastHoverButtonTopRef = useRef<number | null>(null);

	const refreshComments = useCallback(
		(event?: {
			transaction: Transaction;
			appendedTransactions: Transaction[];
		}) => {
			if (!editor) return;
			const nextComments = collectComments(editor);
			setComments(nextComments);
			onCommentsChange?.(nextComments);
			setActiveComment((current) => {
				if (!current) return null;
				let { from, to } = current;
				for (const transaction of event
					? [event.transaction, ...event.appendedTransactions]
					: []) {
					from = transaction.mapping.map(from, 1);
					to = transaction.mapping.map(to, -1);
				}
				return (
					nextComments.find(
						(comment) =>
							comment.id === current.id &&
							comment.from === from &&
							comment.to === to,
					) ?? null
				);
			});
		},
		[editor, onCommentsChange],
	);

	useEffect(() => {
		if (!editor) return;
		refreshComments();
		editor.on("transaction", refreshComments);
		return () => {
			editor.off("transaction", refreshComments);
			onCommentsChange?.([]);
		};
	}, [editor, onCommentsChange, refreshComments]);

	// Reserve gutter space so badges never sit on top of text. Forces a
	// remeasure before paint so badge positions, computed in render from live
	// layout, reflect the reflow. Keyed on comment count only: toggling this
	// per hover would reflow text mid-hover and cause jitter.
	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const hasComments = comments.length > 0;
		const changed = viewport.hasAttribute("data-review-gutter") !== hasComments;
		viewport.toggleAttribute("data-review-gutter", hasComments);
		if (changed) {
			void viewport.offsetHeight;
			setLayoutRevision((value) => value + 1);
		}
		return () => viewport.removeAttribute("data-review-gutter");
	}, [comments.length, viewportRef]);

	useEffect(() => {
		if (open && mode === "thread" && !activeComment) {
			setOpen(false);
			setAnchorRange(null);
		}
	}, [activeComment, mode, open]);

	// Keep the popover anchored to the comment's current text range; editing
	// before an open thread shifts the mark's positions without this.
	useEffect(() => {
		if (mode !== "thread" || !activeComment) return;
		setAnchorRange((current) =>
			current?.from === activeComment.from && current?.to === activeComment.to
				? current
				: { from: activeComment.from, to: activeComment.to },
		);
	}, [activeComment, mode]);

	useEffect(() => {
		const viewport = viewportRef.current;
		const refreshLayout = () => setLayoutRevision((value) => value + 1);
		viewport?.addEventListener("scroll", refreshLayout, { passive: true });
		window.addEventListener("resize", refreshLayout);
		// Dragging a sidebar/panel splitter resizes the viewport via CSS layout
		// alone, without firing a window resize event, so watch the element too.
		const resizeObserver = viewport ? new ResizeObserver(refreshLayout) : null;
		if (viewport) resizeObserver?.observe(viewport);
		return () => {
			viewport?.removeEventListener("scroll", refreshLayout);
			window.removeEventListener("resize", refreshLayout);
			resizeObserver?.disconnect();
		};
	}, [viewportRef]);

	const openThread = useCallback((comment: ReviewComment) => {
		setActiveComment(comment);
		setAnchorRange({ from: comment.from, to: comment.to });
		setMode("thread");
		setOpen(true);
		setReplyDraft("");
	}, []);

	useEffect(() => {
		if (!editor) return;
		const handleClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const markElement = target.closest('[data-review-type="reviewComment"]');
			if (!markElement || !editor.view.dom.contains(markElement)) return;
			const position = editor.view.posAtDOM(markElement, 0);
			const comment =
				commentAtPosition(comments, position) ??
				commentAtPosition(comments, position + 1);
			if (comment) openThread(comment);
		};
		editor.view.dom.addEventListener("click", handleClick);
		return () => editor.view.dom.removeEventListener("click", handleClick);
	}, [comments, editor, openThread]);

	// Shared by both entry points into the composer: the toolbar's Comment
	// button (via `request`, below) and the hover gutter button, which has no
	// text selection to anchor from.
	const startNewCommentAt = useCallback(
		(range: AnchorRange) => {
			if (!editor) return;
			const existing = comments.find(
				(comment) => comment.from < range.to && range.from < comment.to,
			);
			if (existing) {
				openThread(existing);
				return;
			}
			if (findConflictingReviewMark(editor, range)) {
				onMessage?.("Can't comment on an existing suggestion", "error");
				return;
			}
			setActiveComment(null);
			setAnchorRange(range);
			setMode("new");
			setDraft("");
			setOpen(true);
		},
		[comments, editor, onMessage, openThread],
	);

	useEffect(() => {
		if (!editor || request === 0 || requestRef.current === request) return;
		requestRef.current = request;
		const { selection } = editor.state;
		if (!(selection instanceof TextSelection) || selection.empty) return;
		startNewCommentAt({ from: selection.from, to: selection.to });
	}, [editor, request, startNewCommentAt]);

	// Opening a thread from the status bar summary can target a comment that is
	// scrolled out of view, so put the caret on it and scroll before opening.
	useEffect(() => {
		if (
			!editor ||
			!openRequest ||
			openRequestRef.current === openRequest.nonce
		) {
			return;
		}
		openRequestRef.current = openRequest.nonce;
		const comment = comments.find((entry) => entry.id === openRequest.id);
		if (!comment) return;
		editor.view.dispatch(
			editor.state.tr
				.setSelection(TextSelection.create(editor.state.doc, comment.from))
				.scrollIntoView(),
		);
		openThread(comment);
	}, [comments, editor, openRequest, openThread]);

	// Track which block the pointer is over so the gutter "add comment" button
	// can be shown for it without requiring a text selection first.
	useEffect(() => {
		if (open) setHoveredBlock(null);
	}, [open]);

	useEffect(() => {
		if (!editor) return;
		const viewport = viewportRef.current;
		if (!viewport) return;
		const clearHover = () => setHoveredBlock(null);
		const updateHover = (event: MouseEvent) => {
			if (open || !editor.state.selection.empty) {
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
			// Trigger the hoverable comment button near the gutter only
			const viewportRect = viewport.getBoundingClientRect();
			const paddingInlineEnd =
				Number.parseFloat(getComputedStyle(editor.view.dom).paddingInlineEnd) ||
				0;
			const textInlineEnd = contentRect.right - paddingInlineEnd;
			if (
				event.clientX < textInlineEnd - GUTTER_HOVER_TEXT_BUFFER_PX ||
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
	}, [editor, open, viewportRef]);

	useLayoutEffect(() => {
		// The revision invalidates the position when the editor viewport scrolls;
		// the thread and drafts do the same when new content grows the popover.
		void layoutRevision;
		void activeComment;
		void draft;
		void replyDraft;
		if (
			!editor ||
			!popoverEl ||
			!open ||
			!anchorRange ||
			!viewportRef.current
		) {
			return;
		}
		void computePosition(selectionReference(editor, anchorRange), popoverEl, {
			strategy: "absolute",
			placement: "bottom-start",
			middleware: [
				offset(10),
				flip({ boundary: viewportRef.current, padding: 8 }),
				shift({ boundary: viewportRef.current, padding: 8 }),
				size({
					boundary: viewportRef.current,
					padding: 8,
					apply({ availableHeight, elements }) {
						elements.floating.style.maxBlockSize = `${Math.max(160, availableHeight)}px`;
					},
				}),
			],
		}).then(({ x, y }) => setPosition({ x, y }));
	}, [
		activeComment,
		anchorRange,
		draft,
		editor,
		layoutRevision,
		open,
		popoverEl,
		replyDraft,
		viewportRef,
	]);

	// Only the new-comment composer grabs focus; opening an existing thread
	// leaves the editor focused.
	useEffect(() => {
		if (!open || mode !== "new") return;
		const frame = window.requestAnimationFrame(() =>
			commentInputRef.current?.focus(),
		);
		return () => window.cancelAnimationFrame(frame);
	}, [mode, open]);

	const close = useCallback(() => {
		setOpen(false);
		setActiveComment(null);
	}, []);

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (popoverEl?.contains(target)) return;
			if (
				target instanceof Element &&
				target.closest("[data-review-comment-anchor]")
			) {
				return;
			}
			close();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			close();
			editor?.commands.focus();
		};
		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [close, editor, open, popoverEl]);

	const addComment = useCallback(() => {
		if (!editor || !anchorRange || !draft.trim()) return;
		const markType = editor.state.schema.marks.reviewMark;
		if (!markType) return;
		if (findConflictingReviewMark(editor, anchorRange)) {
			onMessage?.("Can't comment on an existing suggestion", "error");
			close();
			return;
		}
		const id = generateCommentId();
		const attrs: ReviewMarkAttrs = {
			type: "reviewComment",
			body: draft.trim(),
			id,
			replies: [],
			resolved: false,
		};
		editor.view.dispatch(
			editor.state.tr.addMark(
				anchorRange.from,
				anchorRange.to,
				markType.create(attrs),
			),
		);
		setActiveComment({
			id,
			from: anchorRange.from,
			to: anchorRange.to,
			attrs,
		});
		// No toast: the thread appearing in place is its own confirmation.
		setMode("thread");
		setDraft("");
	}, [anchorRange, close, draft, editor, onMessage]);

	const addReply = useCallback(() => {
		if (!editor || !activeComment || !replyDraft.trim()) return;
		const reply: ReviewReply = {
			id: nextReplyId(activeComment.attrs.replies),
			body: replyDraft.trim(),
			author: "human",
			createdAt: new Date().toISOString(),
		};
		const attrs: ReviewMarkAttrs = {
			...activeComment.attrs,
			replies: [...(activeComment.attrs.replies ?? []), reply],
		};
		updateComment(editor, activeComment, attrs);
		setActiveComment({ ...activeComment, attrs });
		setReplyDraft("");
		onMessage?.("Reply added", "success");
	}, [activeComment, editor, onMessage, replyDraft]);

	const toggleResolved = useCallback(() => {
		if (!editor || !activeComment) return;
		const attrs = setCommentResolved(
			editor,
			activeComment,
			!activeComment.attrs.resolved,
		);
		setActiveComment({ ...activeComment, attrs });
	}, [activeComment, editor]);

	const removeComment = useCallback(() => {
		if (!editor || !activeComment) return;
		deleteComment(editor, activeComment);
		close();
	}, [activeComment, close, editor]);

	const copyAgentPrompt = useCallback(async () => {
		if (!editor || !activeComment) return;
		const prompt = buildReviewAgentPrompt({
			filePath,
			commentId: activeComment.id,
		});
		try {
			await navigator.clipboard.writeText(prompt);
			onMessage?.("Agent prompt copied", "success");
		} catch {
			onMessage?.("Could not copy agent prompt", "error");
		}
	}, [activeComment, editor, filePath, onMessage]);

	if (!editor) return null;

	// Indicators live in the gutter beside the content column so they never
	// overlap text. Comments sharing a line collapse into one badge whose count
	// totals that line's thread messages.
	type GutterBadge = {
		comment: ReviewComment;
		count: number;
		resolved: boolean;
		blockStart: number;
	};
	const badges = new Map<number, GutterBadge>();
	let gutterInlineEnd = 0;
	let hoverButtonTop: number | null = null;
	const viewport = viewportRef.current;
	if (viewport) {
		const viewportRect = viewport.getBoundingClientRect();
		const contentEl = editor.view.dom;
		// Right-align badges just inside the content column's end padding so they
		// stay visible even when the window is narrower than the column.
		gutterInlineEnd =
			viewport.clientWidth -
			(contentEl.getBoundingClientRect().right -
				viewportRect.left +
				viewport.scrollLeft) +
			4;
		// Centers a 20px gutter control on the line starting at `pos`.
		const gutterTopAt = (pos: number) => {
			const coords = editor.view.coordsAtPos(pos);
			return {
				lineKey: Math.round(coords.top),
				top:
					coords.top -
					viewportRect.top +
					viewport.scrollTop +
					(coords.bottom - coords.top - 20) / 2,
			};
		};
		for (const comment of comments) {
			const { lineKey, top } = gutterTopAt(comment.from);
			const count = 1 + (comment.attrs.replies?.length ?? 0);
			const existing = badges.get(lineKey);
			if (existing) {
				existing.count += count;
				existing.resolved =
					existing.resolved && comment.attrs.resolved === true;
			} else {
				badges.set(lineKey, {
					comment,
					count,
					resolved: comment.attrs.resolved === true,
					blockStart: top,
				});
			}
		}
		if (hoveredBlock && !open) {
			const { lineKey, top } = gutterTopAt(hoveredBlock.from);
			// A block that already has a comment badge on its first line keeps
			// just that one gutter affordance instead of stacking a second icon.
			if (!badges.has(lineKey)) hoverButtonTop = top;
		}
	}
	if (hoverButtonTop !== null) lastHoverButtonTopRef.current = hoverButtonTop;
	const hoverButtonPosition = lastHoverButtonTopRef.current;

	return (
		<>
			<div className="pointer-events-none absolute inset-0 z-[3]">
				{[...badges.values()].map((badge) => (
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
								insetInlineEnd: `${gutterInlineEnd}px`,
								insetBlockStart: `${badge.blockStart}px`,
							} satisfies CSSProperties
						}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => openThread(badge.comment)}
					>
						<MingcuteChat3Line className="size-3.5" />
						{badge.count}
					</button>
				))}
				{hoverButtonPosition !== null && (
					<button
						type="button"
						aria-label="Add comment"
						data-review-comment-anchor
						title="Add comment"
						className={cn(
							"absolute flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground",
							hoverButtonTop !== null
								? "pointer-events-auto opacity-100"
								: "pointer-events-none",
						)}
						style={
							{
								insetInlineEnd: `${gutterInlineEnd}px`,
								insetBlockStart: `${hoverButtonPosition}px`,
							} satisfies CSSProperties
						}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => hoveredBlock && startNewCommentAt(hoveredBlock)}
					>
						<MingcuteChat3Line className="size-3.5" />
					</button>
				)}
			</div>
			{open && anchorRange && (mode === "new" || activeComment) && (
				<div
					ref={setPopoverEl}
					role="dialog"
					aria-label={mode === "new" ? "Add comment" : "Comment thread"}
					data-review-comment-popover
					className={cn(
						"absolute z-[5] flex w-[min(21rem,calc(100vw-1rem))] flex-col rounded-[var(--radius-popover)] border border-border bg-popover text-popover-foreground shadow-overlay",
						mode === "new" && "px-2 py-1.5",
					)}
					style={{
						insetInlineStart: `${position.x}px`,
						insetBlockStart: `${position.y}px`,
					}}
				>
					{mode === "new" ? (
						<CommentComposer
							inputRef={commentInputRef}
							value={draft}
							onChange={setDraft}
							onSubmit={addComment}
							placeholder="Add a comment…"
							ariaLabel="Comment text"
						/>
					) : activeComment ? (
						<div className="group/thread flex min-h-0 flex-1 flex-col">
							<div className="min-h-0 flex-1 overflow-y-auto p-3">
								<div className="flex h-6 items-center gap-2">
									<span className="text-xs font-semibold">
										{authorLabel(
											activeComment.attrs.metadata?.author === "agent"
												? "agent"
												: "human",
										)}
									</span>
									<div className="ms-auto flex items-center gap-0.5">
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											aria-label={
												activeComment.attrs.resolved ? "Reopen" : "Resolve"
											}
											title={
												activeComment.attrs.resolved ? "Reopen" : "Resolve"
											}
											onClick={toggleResolved}
										>
											{activeComment.attrs.resolved ? (
												<MingcuteCheckCircleFill className="text-brand" />
											) : (
												<MingcuteCheckLine />
											)}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											data-review-copy-agent-prompt
											aria-label="Copy agent prompt"
											title="Copy a prompt asking an agent to address this comment"
											onClick={() => void copyAgentPrompt()}
										>
											<MingcuteCopy2Line />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											aria-label="Delete comment"
											title="Delete comment"
											className="hover:bg-destructive/10 hover:text-destructive"
											onClick={removeComment}
										>
											<MingcuteDelete2Line />
										</Button>
									</div>
								</div>
								<blockquote className="mt-1 line-clamp-2 border-s-2 border-brand-accent ps-2 text-xs leading-snug text-muted-foreground">
									{editor.state.doc.textBetween(
										activeComment.from,
										activeComment.to,
										"\n",
									)}
								</blockquote>
								<p className="mt-1.5 whitespace-pre-wrap text-[0.8125rem] leading-relaxed">
									{activeComment.attrs.body}
								</p>
								{(activeComment.attrs.replies ?? []).map((reply) => (
									<div key={reply.id} className="mt-2.5">
										<div className="flex items-baseline gap-2">
											<span className="text-xs font-semibold">
												{authorLabel(reply.author)}
											</span>
											{formatRelativeTime(reply.createdAt) && (
												<span className="text-[11px] text-muted-foreground">
													{formatRelativeTime(reply.createdAt)}
												</span>
											)}
										</div>
										<p className="mt-0.5 whitespace-pre-wrap text-[0.8125rem] leading-relaxed">
											{reply.body}
										</p>
									</div>
								))}
								<div className="mt-2.5">
									<CommentComposer
										value={replyDraft}
										onChange={setReplyDraft}
										onSubmit={addReply}
										placeholder="Reply…"
										ariaLabel="Reply text"
									/>
								</div>
							</div>
						</div>
					) : null}
				</div>
			)}
		</>
	);
}
