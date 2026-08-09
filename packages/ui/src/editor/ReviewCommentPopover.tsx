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
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import MingcuteArrowUpLine from "~icons/mingcute/arrow-up-line";
import MingcuteCheckCircleFill from "~icons/mingcute/check-circle-fill";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteDelete2Line from "~icons/mingcute/delete-2-line";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { ReviewCommentGutter, useLayoutChange } from "./ReviewCommentGutter";
import {
	buildReviewAgentPrompt,
	copyAgentPrompt,
	deleteComment,
	REVIEW_THREAD_COMMAND_EVENT,
	type ReviewComment,
	type ReviewThread,
	type ReviewThreadCommand,
	setCommentResolved,
	toReviewThread,
	updateComment,
} from "./reviewComments";

type AnchorRange = { from: number; to: number };
type PopoverMode = "new" | "thread";

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
		if (!measureRef.current) {
			measureRef.current = document.createElement("canvas");
		}
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
	onMessage,
	onThreadsChange,
}: {
	editor: Editor | null;
	filePath: string;
	viewportRef: RefObject<HTMLDivElement | null>;
	request: number;
	onMessage?: (message: string, type: "success" | "error") => void;
	/** Publishes the document's threads as plain data, so the toolbar can list
	 * them without walking the document again or holding the editor. */
	onThreadsChange?: (threads: ReviewThread[]) => void;
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

	const refreshComments = (event?: {
		transaction: Transaction;
		appendedTransactions: Transaction[];
	}) => {
		if (!editor) return;
		const nextComments = collectComments(editor);
		setComments(nextComments);
		onThreadsChange?.(nextComments.map((c) => toReviewThread(editor, c)));
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
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	useEffect(() => {
		if (!editor) return;
		refreshComments();
		editor.on("transaction", refreshComments);
		return () => {
			editor.off("transaction", refreshComments);
			onThreadsChange?.([]);
		};
	}, [editor, onThreadsChange]);

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

	const openThread = (comment: ReviewComment) => {
		setActiveComment(comment);
		setAnchorRange({ from: comment.from, to: comment.to });
		setMode("thread");
		setOpen(true);
		setReplyDraft("");
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
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
	}, [comments, editor]);

	// Shared by both entry points into the composer: the toolbar's Comment
	// button (via `request`, below) and the hover gutter button, which has no
	// text selection to anchor from.
	const startNewCommentAt = (range: AnchorRange) => {
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
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	useEffect(() => {
		if (!editor || request === 0 || requestRef.current === request) return;
		requestRef.current = request;
		const { selection } = editor.state;
		if (!(selection instanceof TextSelection) || selection.empty) return;
		startNewCommentAt({ from: selection.from, to: selection.to });
	}, [editor, request]);

	// Commands arrive from the toolbar's list, which knows ids but not positions.
	// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	useEffect(() => {
		if (!editor) return;
		const handleCommand = (event: Event) => {
			const { kind, id } = (event as CustomEvent<ReviewThreadCommand>).detail;
			const comment = comments.find((entry) => entry.id === id);
			if (!comment) return;
			if (kind === "toggleResolved") {
				setCommentResolved(editor, comment, comment.attrs.resolved !== true);
				return;
			}
			if (kind === "delete") {
				deleteComment(editor, comment);
				return;
			}
			// The target is often off screen. Scroll the viewport directly rather
			// than leaning on the transaction's scrollIntoView, which does the
			// minimum move and would leave the thread against the bottom edge with
			// its popover clipped. A third from the top leaves room for the popover.
			editor.view.dispatch(
				editor.state.tr.setSelection(
					TextSelection.create(editor.state.doc, comment.from),
				),
			);
			const viewport = viewportRef.current;
			if (viewport) {
				const coords = editor.view.coordsAtPos(comment.from);
				const bounds = viewport.getBoundingClientRect();
				viewport.scrollTo({
					top: Math.max(
						0,
						viewport.scrollTop + (coords.top - bounds.top) - bounds.height / 3,
					),
				});
			}
			openThread(comment);
		};
		window.addEventListener(REVIEW_THREAD_COMMAND_EVENT, handleCommand);
		return () =>
			window.removeEventListener(REVIEW_THREAD_COMMAND_EVENT, handleCommand);
	}, [comments, editor, viewportRef]);

	// Anchored to the comment's live screen position, so it follows both the
	// content growing under it and the viewport moving beneath it.
	const reposition = () => {
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
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	useLayoutEffect(reposition, [reposition]);
	useLayoutChange(viewportRef, reposition);

	// Only the new-comment composer grabs focus; opening an existing thread
	// leaves the editor focused.
	useEffect(() => {
		if (!open || mode !== "new") return;
		const frame = window.requestAnimationFrame(() =>
			commentInputRef.current?.focus(),
		);
		return () => window.cancelAnimationFrame(frame);
	}, [mode, open]);

	const close = () => {
		setOpen(false);
		setActiveComment(null);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
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
	}, [editor, open, popoverEl]);

	const addComment = () => {
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
	};

	const addReply = () => {
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
	};

	const toggleResolved = () => {
		if (!editor || !activeComment) return;
		const attrs = setCommentResolved(
			editor,
			activeComment,
			!activeComment.attrs.resolved,
		);
		setActiveComment({ ...activeComment, attrs });
	};

	const removeComment = () => {
		if (!editor || !activeComment) return;
		deleteComment(editor, activeComment);
		close();
	};

	const copyThreadPrompt = () => {
		if (!activeComment) return;
		void copyAgentPrompt(
			buildReviewAgentPrompt({ filePath, commentId: activeComment.id }),
			onMessage,
		);
	};

	if (!editor) return null;

	return (
		<>
			<ReviewCommentGutter
				editor={editor}
				viewportRef={viewportRef}
				comments={comments}
				popoverOpen={open}
				onOpenThread={openThread}
				onAddComment={startNewCommentAt}
			/>
			{open && anchorRange && (mode === "new" || activeComment) && (
				<div
					ref={setPopoverEl}
					role="dialog"
					aria-label={mode === "new" ? "Add comment" : "Comment thread"}
					data-review-comment-popover
					className={cn(
						"absolute z-5 flex w-[min(21rem,calc(100vw-1rem))] flex-col rounded-[var(--radius-popover)] border border-border bg-popover text-popover-foreground shadow-overlay",
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
											onClick={copyThreadPrompt}
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
