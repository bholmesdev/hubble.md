// biome-ignore-all lint/a11y/useSemanticElements: the rule suggests <table> for
// the grid roles below, but this is a list of comment cards, not tabular data.
// The grid pattern is here for its keyboard model (one tab stop, arrows inside),
// and table markup would fight every bit of the layout to get there.

import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteCheckCircleFill from "~icons/mingcute/check-circle-fill";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteDelete2Line from "~icons/mingcute/delete-2-line";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import {
	buildReviewAgentPrompt,
	copyAgentPrompt,
	type ReviewThread,
	type ReviewThreadCommand,
} from "./reviewComments";

/** Open, resolve, copy, delete. Left/Right walks these in the same order the
 * thread popover shows them. */
const LAST_COLUMN = 3;

type Cell = { row: number; col: number };

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

function GridCell({ children }: { children: ReactNode }) {
	return (
		<span role="gridcell" tabIndex={-1}>
			{children}
		</span>
	);
}

/** One composite widget rather than four tab stops per row: Tab enters it once
 * and moves on, arrows do the rest. */
export function ReviewCommentList({
	filePath,
	threads,
	onCommand,
	onMessage,
}: {
	filePath: string;
	threads: ReviewThread[];
	onCommand: (kind: ReviewThreadCommand["kind"], id: string) => void;
	onMessage?: (message: string, type: "success" | "error") => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const [cell, setCell] = useState<Cell>({ row: 0, col: 0 });
	const [navigating, setNavigating] = useState(false);

	// Resolving drops the row out from under the caret on the Unresolved tab.
	const row = Math.min(cell.row, Math.max(0, threads.length - 1));

	useEffect(() => {
		if (!navigating || threads.length === 0) return;
		const target = listRef.current?.querySelector<HTMLElement>(
			`[data-row="${row}"][data-col="${cell.col}"]`,
		);
		if (target && target !== document.activeElement) target.focus();
	}, [cell.col, threads.length, navigating, row]);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			const last = threads.length - 1;
			const col = cell.col;
			const next: Cell | undefined = {
				ArrowDown: { row: row + 1, col },
				ArrowUp: { row: row - 1, col },
				ArrowRight: { row, col: col + 1 },
				ArrowLeft: { row, col: col - 1 },
				Home: { row: 0, col },
				End: { row: last, col },
			}[event.key];
			if (!next) return;
			event.preventDefault();
			setNavigating(true);
			setCell({
				row: clamp(next.row, last),
				col: clamp(next.col, LAST_COLUMN),
			});
		},
		[cell.col, threads.length, row],
	);

	return (
		<div
			ref={listRef}
			role="grid"
			aria-label="Comments"
			aria-rowcount={threads.length}
			className="max-h-72 space-y-1 overflow-y-auto p-1"
			onKeyDown={onKeyDown}
			onFocus={(event) => {
				// Clicking a cell moves the roving position there too.
				const target = event.target as HTMLElement;
				const at = target.dataset.row;
				if (at !== undefined) {
					setCell({ row: Number(at), col: Number(target.dataset.col) });
				}
				setNavigating(true);
			}}
			onBlur={(event) => {
				// A null relatedTarget means the focused row was just removed; stay
				// navigating so the effect can put focus back.
				const next = event.relatedTarget as Node | null;
				if (next && !listRef.current?.contains(next)) setNavigating(false);
			}}
		>
			{threads.map((thread, index) => (
				<Row
					key={thread.id}
					filePath={filePath}
					thread={thread}
					index={index}
					focusedCol={index === row ? cell.col : null}
					onCommand={onCommand}
					onMessage={onMessage}
				/>
			))}
		</div>
	);
}

function Row({
	filePath,
	thread,
	index,
	focusedCol,
	onCommand,
	onMessage,
}: {
	filePath: string;
	thread: ReviewThread;
	index: number;
	/** Which column holds the single tab stop, when this is the active row. */
	focusedCol: number | null;
	onCommand: (kind: ReviewThreadCommand["kind"], id: string) => void;
	onMessage?: (message: string, type: "success" | "error") => void;
}) {
	const resolved = thread.resolved;

	const cell = (col: number) => ({
		"data-row": index,
		"data-col": col,
		tabIndex: focusedCol === col ? 0 : -1,
	});

	const action = (col: number) => ({
		...cell(col),
		type: "button" as const,
		variant: "ghost" as const,
		size: "icon-xs" as const,
	});

	return (
		<div
			role="row"
			tabIndex={-1}
			aria-rowindex={index + 1}
			className={cn(
				"group/row relative rounded-sm transition-colors hover:bg-accent focus-within:bg-accent",
				resolved && "opacity-50",
			)}
		>
			<GridCell>
				<button
					type="button"
					{...cell(0)}
					className="w-full cursor-pointer rounded-sm px-2 py-1.5 text-start outline-hidden focus-visible:ring-1 focus-visible:ring-ring/40"
					onClick={() => onCommand("open", thread.id)}
				>
					<span
						className={cn(
							"line-clamp-1 border-s-2 ps-1.5 text-[11px] leading-snug text-muted-foreground group-hover/row:pe-20 group-focus-within/row:pe-20",
							resolved ? "border-muted-foreground/40" : "border-brand-accent",
						)}
					>
						{thread.anchor}
					</span>
					<span className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug">
						{thread.body}
					</span>
				</button>
			</GridCell>
			<span
				role="presentation"
				className="absolute end-1 top-1.5 flex h-[1.375em] items-center gap-0.5 rounded-sm bg-accent text-[11px] opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
			>
				<GridCell>
					<Button
						{...action(1)}
						aria-label={resolved ? "Reopen" : "Resolve"}
						title={resolved ? "Reopen" : "Resolve"}
						onClick={() => onCommand("toggleResolved", thread.id)}
					>
						{resolved ? (
							<MingcuteCheckCircleFill className="text-brand" />
						) : (
							<MingcuteCheckLine />
						)}
					</Button>
				</GridCell>
				<GridCell>
					<Button
						{...action(2)}
						data-review-copy-agent-prompt
						aria-label="Copy agent prompt"
						title="Copy a prompt asking an agent to address this comment"
						onClick={() =>
							void copyAgentPrompt(
								buildReviewAgentPrompt({ filePath, commentId: thread.id }),
								onMessage,
							)
						}
					>
						<MingcuteCopy2Line />
					</Button>
				</GridCell>
				<GridCell>
					<Button
						{...action(3)}
						aria-label="Delete comment"
						title="Delete comment"
						className="hover:bg-destructive/10 hover:text-destructive"
						onClick={() => onCommand("delete", thread.id)}
					>
						<MingcuteDelete2Line />
					</Button>
				</GridCell>
			</span>
		</div>
	);
}
