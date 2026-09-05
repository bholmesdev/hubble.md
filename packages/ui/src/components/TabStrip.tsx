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
};

export type TabStripProps = {
	tabs: TabStripItem[];
	activeTabId: string | null;
	onActivate: (id: string) => void;
	onClose: (id: string) => void;
	onNewTab?: () => void;
	newTabTitle?: string;
	onRename?: (id: string, nextName: string) => void;
};

const tabAt = (strip: HTMLElement | null, index: number) =>
	strip?.querySelectorAll<HTMLElement>('[role="tab"]')[index];

/**
 * Open notes in the top bar, where the file name used to sit. The strip is
 * one stop in the page's tab order; arrow keys move between notes from there.
 */
export function TabStrip({
	tabs,
	activeTabId,
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

	const anchor = Math.max(
		0,
		tabs.findIndex((tab) => tab.id === activeTabId),
	);

	useEffect(() => {
		tabAt(stripRef.current, anchor)?.scrollIntoView?.({
			block: "nearest",
			inline: "nearest",
		});
	}, [anchor]);

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
		setDraft(tab.label);
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
		if (!nextName || !current || nextName === current.label || !onRename)
			return;
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
		<div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
			{tabs.length > 0 ? (
				<div
					ref={stripRef}
					role="tablist"
					aria-label="Open notes"
					onKeyDown={onKeyDown}
					className="flex min-w-0 items-stretch gap-px overflow-x-auto"
				>
					{tabs.map((tab, index) => {
						const active = tab.id === activeTabId;
						const editing = editingId === tab.id;
						return (
							<div
								key={tab.id}
								className={cn(
									"group flex h-7 min-w-0 items-center gap-0.5 rounded-sm pr-0.5 pl-2",
									active
										? "bg-accent/50 text-foreground"
										: "text-muted-foreground hover:bg-accent/20",
								)}
								style={NO_DRAG_STYLE}
							>
								{editing ? (
									<input
										ref={renameInputRef}
										className="h-5 w-28 min-w-0 select-text rounded-sm bg-transparent px-0.5 text-xs text-foreground outline-none"
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
										onClick={() => {
											if (active && onRename) {
												beginRename(tab);
												return;
											}
											onActivate(tab.id);
										}}
										onAuxClick={(event) => {
											if (event.button !== 1) return;
											event.preventDefault();
											onClose(tab.id);
										}}
										className="max-w-36 truncate py-0.5 text-xs"
									>
										{tab.label}
									</button>
								)}
								<button
									type="button"
									tabIndex={-1}
									aria-label={`Close ${tab.label}`}
									onClick={() => onClose(tab.id)}
									className={cn(
										"rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
										active && "opacity-100",
									)}
								>
									<MingcuteCloseLine className="size-3" />
								</button>
							</div>
						);
					})}
				</div>
			) : null}
			{onNewTab ? (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="New tab"
					title={newTabTitle}
					onClick={onNewTab}
					className="shrink-0"
					style={NO_DRAG_STYLE}
				>
					<MingcuteAddLine className="size-3.5" />
				</Button>
			) : null}
		</div>
	);
}
