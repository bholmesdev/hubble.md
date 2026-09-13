import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteAddLine from "~icons/mingcute/add-line";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";

const NO_DRAG_STYLE = {
	WebkitAppRegion: "no-drag",
} as CSSProperties;

export type TabStripItem = {
	id: string;
	label: string;
	/** Shown on hover, where the full path disambiguates two similar labels. */
	title: string;
	/** File name without a folder prefix. Used when renaming. */
	name?: string;
};

export type TabStripProps = {
	tabs: TabStripItem[];
	activeTabId: string | null;
	/** Removes the first tab's bottom-left flare so its edge meets the expanded sidebar's divider. */
	flushStart?: boolean;
	/** Enables hiding crowded tabs when the caller provides another way to select them. */
	onCollapsedChange?: (collapsed: boolean) => void;
	onActivate: (id: string) => void;
	onClose: (id: string) => void;
	onNewTab?: () => void;
	newTabTitle?: string;
	onRename?: (id: string, nextName: string) => void;
};

const tabAt = (strip: HTMLElement | null, index: number) =>
	strip?.querySelectorAll<HTMLElement>('[role="tab"]')[index];

/**
 * The strip is one stop in the page's tab order; arrow keys move between notes.
 */
export function TabStrip({
	tabs,
	activeTabId,
	flushStart = false,
	onCollapsedChange,
	onActivate,
	onClose,
	onNewTab,
	newTabTitle = "New tab",
	onRename,
}: TabStripProps) {
	const stripRef = useRef<HTMLDivElement | null>(null);
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [collapsed, setCollapsed] = useState(false);
	const collapsedRef = useRef(false);
	const tabCount = tabs.length;

	useEffect(() => {
		const update = (next: boolean) => {
			if (next === collapsedRef.current) return;
			collapsedRef.current = next;
			// Let the caller move focus before the tabs become inert.
			onCollapsedChange?.(next);
			setCollapsed(next);
		};
		const strip = stripRef.current;
		if (!onCollapsedChange || !strip || tabCount === 0) {
			update(false);
			return;
		}
		const measure = (width: number) => update(width / tabCount < 48);
		measure(strip.getBoundingClientRect().width);
		const observer = new ResizeObserver(([entry]) => {
			measure(entry.contentRect.width);
		});
		observer.observe(strip);
		return () => observer.disconnect();
	}, [onCollapsedChange, tabCount]);

	const anchor = Math.max(
		0,
		tabs.findIndex((tab) => tab.id === activeTabId),
	);

	useEffect(() => {
		if (!editingId) return;
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [editingId]);

	useEffect(() => {
		if (editingId && !tabs.some((tab) => tab.id === editingId)) {
			setEditingId(null);
			setDraft("");
		}
	}, [editingId, tabs]);

	const beginRename = (tab: TabStripItem) => {
		if (!onRename) return;
		setDraft(tab.name ?? tab.label);
		setEditingId(tab.id);
	};

	const cancelRename = () => {
		setEditingId(null);
		setDraft("");
	};

	const commitRename = (id: string) => {
		const nextName = draft.trim();
		const current = tabs.find((tab) => tab.id === id);
		cancelRename();
		const original = current?.name ?? current?.label;
		if (!nextName || !current || nextName === original || !onRename) return;
		onRename(id, nextName);
	};

	const focusTabAt = (index: number) => {
		tabAt(stripRef.current, index)?.focus();
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (editingId) return;
		const target =
			event.key === "ArrowLeft"
				? (anchor - 1 + tabs.length) % tabs.length
				: event.key === "ArrowRight"
					? (anchor + 1) % tabs.length
					: event.key === "Home"
						? 0
						: event.key === "End"
							? tabs.length - 1
							: null;
		if (target !== null) {
			event.preventDefault();
			onActivate(tabs[target].id);
			focusTabAt(target);
			return;
		}
		if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault();
			onClose(tabs[anchor].id);
		}
	};

	if (tabs.length === 0 && !onNewTab) return null;

	return (
		<div className="relative z-10 flex min-w-0 flex-1 items-end gap-1 overflow-hidden">
			{tabs.length > 0 ? (
				<div
					className="min-w-0 flex-initial"
					style={{
						width: `calc(${tabs.length} * 12rem)`,
					}}
				>
					<div
						ref={stripRef}
						role="tablist"
						aria-label="Open notes"
						aria-hidden={collapsed || undefined}
						inert={collapsed}
						onKeyDown={onKeyDown}
						// Keep the measured width while hidden so collapsing cannot trigger a resize loop.
						className={cn(
							"flex min-w-0 items-stretch overflow-hidden transition-[opacity,visibility] [transition-duration:150ms,0ms] motion-reduce:transition-none",
							collapsed
								? "invisible opacity-0 [transition-delay:0ms,150ms]"
								: "visible opacity-100",
						)}
					>
						{tabs.map((tab, index) => {
							const active = tab.id === activeTabId;
							const editing = editingId === tab.id;
							return (
								<div
									key={tab.id}
									data-selected={active ? "true" : undefined}
									className={cn(
										"@container/tab group relative isolate flex h-8 min-w-0 max-w-48 flex-1 items-center overflow-hidden pb-1",
										active
											? "text-foreground"
											: "text-muted-foreground hover:text-foreground before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:bottom-1 before:-z-10 before:rounded-md hover:before:bg-muted/60",
										!active &&
											(index < tabs.length - 1
												? tabs[index + 1].id !== activeTabId
												: onNewTab) &&
											"after:pointer-events-none after:absolute after:right-0 after:top-1 after:h-5 after:w-px after:bg-border",
									)}
									style={NO_DRAG_STYLE}
								>
									{active ? (
										<TabOutline flushStart={flushStart && index === 0} />
									) : null}
									{editing ? (
										<input
											ref={renameInputRef}
											className="h-5 min-w-0 flex-1 select-text rounded-sm bg-transparent px-[min(1.25rem,20cqw)] text-xs text-foreground outline-none @min-[96px]/tab:pr-10"
											value={draft}
											aria-label={`Rename ${tab.label}`}
											onBlur={() => commitRename(tab.id)}
											onChange={(event) => setDraft(event.target.value)}
											onKeyDown={(event) => {
												event.stopPropagation();
												if (event.key === "Enter") {
													event.preventDefault();
													commitRename(tab.id);
												} else if (event.key === "Escape") {
													event.preventDefault();
													cancelRename();
												}
											}}
										/>
									) : (
										<button
											type="button"
											role="tab"
											aria-selected={active}
											tabIndex={index === anchor ? 0 : -1}
											title={tab.title}
											onClick={() => onActivate(tab.id)}
											onDoubleClick={() => {
												if (active) beginRename(tab);
											}}
											onAuxClick={(event) => {
												if (event.button !== 1) return;
												event.preventDefault();
												onClose(tab.id);
											}}
											className="min-w-0 flex-1 truncate px-[min(1.25rem,20cqw)] py-0.5 text-start text-xs before:absolute before:inset-0 @min-[96px]/tab:pr-10"
										>
											{tab.label}
										</button>
									)}
									{/* Narrow tabs need their full width for the title, even on hover. */}
									<button
										type="button"
										tabIndex={-1}
										aria-label={`Close ${tab.label}`}
										onClick={() => onClose(tab.id)}
										className={cn(
											"absolute top-1.25 right-4 hidden rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 @min-[96px]/tab:block",
											active && "opacity-100",
										)}
									>
										<MingcuteCloseLine className="size-3.5" />
									</button>
								</div>
							);
						})}
					</div>
				</div>
			) : null}
			{onNewTab ? (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="New tab"
					title={newTabTitle}
					onClick={onNewTab}
					className={cn("w-8 shrink-0 self-center", collapsed && "ms-auto")}
					style={NO_DRAG_STYLE}
				>
					<MingcuteAddLine className="size-3.5" />
				</Button>
			) : null}
		</div>
	);
}

function TabOutline({ flushStart }: { flushStart: boolean }) {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 -z-10"
		>
			<div className="absolute inset-y-0 inset-x-2.5 border-t border-border bg-background" />
			{["left-0", "right-0 -scale-x-100"].map((side) => {
				const edge =
					flushStart && side === "left-0"
						? "M.5 32 V6.5 Q.5 .5 6.5 .5 H10"
						: "M0 31.5 Q4 31.5 4 27.5 V6.5 Q4 .5 10 .5";
				return (
					<svg
						aria-hidden="true"
						key={side}
						viewBox="0 0 10 32"
						className={`absolute top-0 h-8 w-2.5 ${side}`}
					>
						<path d={`${edge} V32 H0 Z`} fill="var(--background)" />
						<path d={edge} fill="none" stroke="var(--border)" />
					</svg>
				);
			})}
		</div>
	);
}
