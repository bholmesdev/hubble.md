import {
	computePosition,
	flip,
	offset,
	shift,
	type VirtualElement,
} from "@floating-ui/dom";
import type { ReviewMarkAttrs, ReviewReply } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
	type CSSProperties,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteCommentLine from "~icons/mingcute/comment-line";
import MingcuteSendPlaneLine from "~icons/mingcute/send-plane-line";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";

type ReviewComment = {
	id: string;
	from: number;
	to: number;
	attrs: ReviewMarkAttrs;
};

type AnchorRange = { from: number; to: number };
type PopoverMode = "new" | "thread";

export function buildReviewAgentPrompt({
	filePath,
	commentId,
	anchorText,
	commentBody,
}: {
	filePath: string;
	commentId: string;
	anchorText: string;
	commentBody: string;
}) {
	return `Address Hubble review comment ${commentId} in ${filePath}.

Anchored text:
${anchorText}

Comment:
${commentBody}

Read the file before editing. Reply by appending a reply object to this comment's inline hubble-review metadata, then resolve the comment only if the request is addressed. Preserve CriticMarkup markers, the anchor id, unknown review metadata, and unrelated Markdown.`;
}

function reviewCommentAttrs(mark: Mark) {
	if (mark.type.name !== "reviewMark" || mark.attrs.type !== "reviewComment") {
		return null;
	}
	if (typeof mark.attrs.id !== "string") return null;
	return mark.attrs as ReviewMarkAttrs;
}

function collectComments(editor: Editor): ReviewComment[] {
	const comments = new Map<string, ReviewComment>();
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
			const existing = comments.get(attrs.id);
			comments.set(attrs.id, {
				id: attrs.id,
				from: Math.min(existing?.from ?? pos, pos),
				to: Math.max(existing?.to ?? pos + node.nodeSize, pos + node.nodeSize),
				attrs,
			});
			return false;
		},
	);
	return [...comments.values()].sort((a, b) => a.from - b.from);
}

function commentAtPosition(comments: ReviewComment[], position: number) {
	return comments.find(
		(comment) => comment.from <= position && position <= comment.to,
	);
}

function nextCommentId(comments: ReviewComment[]) {
	const highest = comments.reduce((max, comment) => {
		const value = Number(comment.id.match(/^c(\d+)$/)?.[1] ?? 0);
		return Math.max(max, value);
	}, 0);
	return `c${highest + 1}`;
}

function nextReplyId(replies: ReviewReply[] = []) {
	const highest = replies.reduce((max, reply) => {
		const value = Number(reply.id.match(/^r(\d+)$/)?.[1] ?? 0);
		return Math.max(max, value);
	}, 0);
	return `r${highest + 1}`;
}

function updateComment(
	editor: Editor,
	comment: ReviewComment,
	attrs: ReviewMarkAttrs,
) {
	const markType = editor.state.schema.marks.reviewMark;
	if (!markType) return;
	const transaction = editor.state.tr.removeMark(
		comment.from,
		comment.to,
		markType,
	);
	transaction.addMark(comment.from, comment.to, markType.create(attrs));
	editor.view.dispatch(transaction);
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
}: {
	editor: Editor | null;
	filePath: string;
	viewportRef: RefObject<HTMLDivElement | null>;
	request: number;
	onMessage?: (message: string, type: "success" | "error") => void;
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
	const [layoutRevision, setLayoutRevision] = useState(0);

	const refreshComments = useCallback(() => {
		if (!editor) return;
		const nextComments = collectComments(editor);
		setComments(nextComments);
		setActiveComment((current) =>
			current
				? (nextComments.find((comment) => comment.id === current.id) ?? null)
				: null,
		);
	}, [editor]);

	useEffect(() => {
		if (!editor) return;
		refreshComments();
		editor.on("transaction", refreshComments);
		return () => {
			editor.off("transaction", refreshComments);
		};
	}, [editor, refreshComments]);

	useEffect(() => {
		if (open && mode === "thread" && !activeComment) {
			setOpen(false);
			setAnchorRange(null);
		}
	}, [activeComment, mode, open]);

	useEffect(() => {
		const viewport = viewportRef.current;
		const refreshLayout = () => setLayoutRevision((value) => value + 1);
		viewport?.addEventListener("scroll", refreshLayout, { passive: true });
		window.addEventListener("resize", refreshLayout);
		return () => {
			viewport?.removeEventListener("scroll", refreshLayout);
			window.removeEventListener("resize", refreshLayout);
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

	useEffect(() => {
		if (!editor || request === 0 || requestRef.current === request) return;
		requestRef.current = request;
		const { selection } = editor.state;
		if (!(selection instanceof TextSelection) || selection.empty) return;
		const existing = comments.find(
			(comment) => comment.from < selection.to && selection.from < comment.to,
		);
		if (existing) {
			openThread(existing);
			return;
		}
		setActiveComment(null);
		setAnchorRange({ from: selection.from, to: selection.to });
		setMode("new");
		setDraft("");
		setOpen(true);
	}, [comments, editor, openThread, request]);

	useLayoutEffect(() => {
		// The revision invalidates the position when the editor viewport scrolls.
		void layoutRevision;
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
			],
		}).then(({ x, y }) => setPosition({ x, y }));
	}, [anchorRange, editor, layoutRevision, open, popoverEl, viewportRef]);

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
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [close, open, popoverEl]);

	const addComment = useCallback(() => {
		if (!editor || !anchorRange || !draft.trim()) return;
		const markType = editor.state.schema.marks.reviewMark;
		if (!markType) return;
		const attrs: ReviewMarkAttrs = {
			type: "reviewComment",
			body: draft.trim(),
			id: nextCommentId(comments),
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
			id: attrs.id as string,
			from: anchorRange.from,
			to: anchorRange.to,
			attrs,
		});
		setMode("thread");
		setDraft("");
		onMessage?.("Comment added", "success");
	}, [anchorRange, comments, draft, editor, onMessage]);

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
		const attrs: ReviewMarkAttrs = {
			...activeComment.attrs,
			resolved: !activeComment.attrs.resolved,
		};
		updateComment(editor, activeComment, attrs);
		setActiveComment({ ...activeComment, attrs });
		onMessage?.(
			attrs.resolved ? "Comment resolved" : "Comment reopened",
			"success",
		);
	}, [activeComment, editor, onMessage]);

	const askAgent = useCallback(async () => {
		if (!editor || !activeComment) return;
		const prompt = buildReviewAgentPrompt({
			filePath,
			commentId: activeComment.id,
			anchorText: editor.state.doc.textBetween(
				activeComment.from,
				activeComment.to,
				"\n",
			),
			commentBody: activeComment.attrs.body ?? "",
		});
		try {
			await navigator.clipboard.writeText(prompt);
			onMessage?.("Agent request copied", "success");
		} catch {
			onMessage?.("Could not copy agent request", "error");
		}
	}, [activeComment, editor, filePath, onMessage]);

	if (!editor) return null;

	return (
		<>
			<div className="pointer-events-none absolute inset-0 z-[3]">
				{comments.map((comment) => {
					const viewport = viewportRef.current;
					if (!viewport) return null;
					const rect = viewport.getBoundingClientRect();
					const coords = editor.view.coordsAtPos(comment.to);
					return (
						<button
							key={comment.id}
							type="button"
							aria-label={`Open comment ${comment.id}`}
							data-review-comment-anchor
							title={
								comment.attrs.resolved ? "Resolved comment" : "Open comment"
							}
							className={cn(
								"pointer-events-auto absolute flex size-6 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground",
								comment.attrs.resolved && "opacity-55",
							)}
							style={
								{
									insetInlineStart: `${coords.right - rect.left + viewport.scrollLeft + 8}px`,
									insetBlockStart: `${coords.top - rect.top + viewport.scrollTop - 2}px`,
								} satisfies CSSProperties
							}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => openThread(comment)}
						>
							<MingcuteCommentLine className="size-3.5" />
						</button>
					);
				})}
			</div>
			{open && anchorRange && (mode === "new" || activeComment) && (
				<div
					ref={setPopoverEl}
					role="dialog"
					aria-label={mode === "new" ? "Add comment" : "Comment thread"}
					data-review-comment-popover
					className="absolute z-[5] flex w-[min(22rem,calc(100vw-1rem))] flex-col gap-3 rounded-[var(--radius-popover)] border border-border bg-popover p-3 text-popover-foreground shadow-overlay"
					style={{
						insetInlineStart: `${position.x}px`,
						insetBlockStart: `${position.y}px`,
					}}
				>
					{mode === "new" ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								addComment();
							}}
						>
							<div className="mb-2 flex items-center justify-between gap-2">
								<strong className="text-xs font-semibold">Add comment</strong>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label="Cancel comment"
									onClick={close}
								>
									<MingcuteCloseLine />
								</Button>
							</div>
							<textarea
								ref={commentInputRef}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								placeholder="Leave a comment…"
								aria-label="Comment text"
								className="min-h-20 w-full resize-y rounded-sm border border-input bg-card px-2.5 py-2 text-xs outline-hidden placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40"
							/>
							<div className="mt-2 flex justify-end gap-1.5">
								<Button type="button" variant="ghost" size="xs" onClick={close}>
									Cancel
								</Button>
								<Button type="submit" size="xs" disabled={!draft.trim()}>
									<MingcuteCommentLine />
									Comment
								</Button>
							</div>
						</form>
					) : activeComment ? (
						<div>
							<div className="flex items-start justify-between gap-2">
								<div>
									<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
										Comment {activeComment.id}
									</div>
									<p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
										{activeComment.attrs.body}
									</p>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label="Close comment"
									onClick={close}
								>
									<MingcuteCloseLine />
								</Button>
							</div>
							{(activeComment.attrs.replies ?? []).map((reply) => (
								<div
									key={reply.id}
									className="mt-2 rounded-sm bg-muted/60 px-2.5 py-2 text-xs"
								>
									<div className="mb-1 text-[10px] font-medium text-muted-foreground">
										{reply.author === "agent" ? "Agent" : "You"}
									</div>
									<p className="whitespace-pre-wrap leading-relaxed">
										{reply.body}
									</p>
								</div>
							))}
							<textarea
								value={replyDraft}
								onChange={(event) => setReplyDraft(event.target.value)}
								placeholder="Reply to this thread…"
								aria-label="Reply text"
								className="mt-3 min-h-16 w-full resize-y rounded-sm border border-input bg-card px-2.5 py-2 text-xs outline-hidden placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40"
							/>
							<div className="mt-2 flex items-center justify-between gap-1.5">
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={() => void askAgent()}
								>
									<MingcuteSendPlaneLine />
									Ask agent
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={toggleResolved}
								>
									<MingcuteCheckLine />
									{activeComment.attrs.resolved ? "Reopen" : "Resolve"}
								</Button>
								<Button
									type="button"
									size="xs"
									disabled={!replyDraft.trim()}
									onClick={addReply}
								>
									<MingcuteSendPlaneLine />
									Reply
								</Button>
							</div>
						</div>
					) : null}
				</div>
			)}
		</>
	);
}
