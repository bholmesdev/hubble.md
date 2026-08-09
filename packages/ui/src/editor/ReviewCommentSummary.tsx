import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import {
	type AriaRole,
	type ReactElement,
	type ReactNode,
	useState,
} from "react";
import MingcuteChat3Line from "~icons/mingcute/chat-3-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import { Button } from "../primitives/button";
import { ReviewCommentList } from "./ReviewCommentList";
import {
	buildReviewCommentsAgentPrompt,
	copyAgentPrompt,
	type ReviewThread,
	type ReviewThreadCommand,
	unresolvedThreads,
} from "./reviewComments";

type Filter = "unresolved" | "resolved" | "all";

const FILTERS: { value: Filter; label: string }[] = [
	{ value: "unresolved", label: "Unresolved" },
	{ value: "resolved", label: "Resolved" },
	{ value: "all", label: "All" },
];

const EMPTY_LABEL: Record<Filter, string> = {
	unresolved: "No unresolved comments",
	resolved: "No resolved comments",
	all: "No comments",
};

export type ReviewCommentSummaryProps = {
	filePath: string;
	threads: ReviewThread[];
	onCommand: (kind: ReviewThreadCommand["kind"], id: string) => void;
	onMessage?: (message: string, type: "success" | "error") => void;
	trigger?: ReactElement;
	triggerChildren?: ReactNode;
	triggerNativeButton?: boolean;
	triggerRole?: AriaRole;
};

/** Toolbar entry point for the document's review threads. The gutter badges
 * only show comments on screen, so this is the one place that lists them all,
 * and the one place that hands the whole set to an agent.
 *
 * Takes plain data and emits commands, so an app can render it in its own
 * toolbar without holding the editor. */
export function ReviewCommentSummary({
	filePath,
	threads,
	onCommand,
	onMessage,
	trigger,
	triggerChildren,
	triggerNativeButton = true,
	triggerRole,
}: ReviewCommentSummaryProps) {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState<Filter>("unresolved");
	const unresolved = unresolvedThreads(threads);
	const visible =
		filter === "all"
			? threads
			: filter === "unresolved"
				? unresolved
				: threads.filter((thread) => thread.resolved);

	const copyUnresolvedPrompt = async () => {
		const copied = await copyAgentPrompt(
			buildReviewCommentsAgentPrompt({ filePath }),
			onMessage,
		);
		// Copying is the last thing you do here, so get out of the way.
		if (copied) setOpen(false);
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger
				nativeButton={triggerNativeButton}
				role={triggerRole}
				render={
					trigger ?? (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Comments"
							title="Comments"
						/>
					)
				}
			>
				{triggerChildren ?? <MingcuteChat3Line className="size-3.5" />}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="end"
					side="bottom"
					sideOffset={4}
					className="isolate z-50"
				>
					<Popover.Popup
						data-review-comment-summary
						className="flex w-[min(20rem,calc(100vw-1rem))] origin-(--transform-origin) flex-col rounded-[var(--radius-popover)] border border-border bg-popover text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
					>
						{threads.length === 0 ? (
							<div className="px-4 py-5 text-center">
								<p className="text-[0.8125rem] font-medium">No comments yet</p>
								<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
									Highlight any text to leave a comment. When you have a few,
									copy a prompt from here and your agent can work through them.
								</p>
							</div>
						) : (
							<>
								<Tabs.Root
									value={filter}
									onValueChange={(value) => setFilter(value as Filter)}
								>
									<Tabs.List className="flex items-center gap-1 border-b border-border p-1">
										{FILTERS.map(({ value, label }) => (
											<Tabs.Tab
												key={value}
												value={value}
												className="cursor-pointer rounded-sm px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors select-none hover:text-foreground data-active:bg-secondary data-active:text-foreground"
											>
												{label}
											</Tabs.Tab>
										))}
									</Tabs.List>
									<Tabs.Panel value={filter}>
										{visible.length === 0 ? (
											<p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
												{EMPTY_LABEL[filter]}
											</p>
										) : (
											<ReviewCommentList
												filePath={filePath}
												threads={visible}
												onMessage={onMessage}
												onCommand={(kind, id) => {
													// Opening jumps to the thread in the document, so the
													// list has done its job and gets out of the way.
													if (kind === "open") setOpen(false);
													onCommand(kind, id);
												}}
											/>
										)}
									</Tabs.Panel>
								</Tabs.Root>
								<div className="border-t border-border p-1">
									<Button
										type="button"
										variant="ghost"
										size="xs"
										data-review-copy-all-prompt
										className="w-full justify-start"
										title="Copy a prompt covering every unresolved comment"
										disabled={unresolved.length === 0}
										onClick={() => void copyUnresolvedPrompt()}
									>
										<MingcuteCopy2Line data-icon="inline-start" />
										{unresolved.length === 0
											? "All comments resolved"
											: "Copy agent prompt"}
									</Button>
								</div>
							</>
						)}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
