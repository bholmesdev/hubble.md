import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import { cn } from "../lib/utils";

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
};

/**
 * The row of open notes above the editor. It shows from the first note
 * onwards: arriving only at the second would shove the editor down mid-click,
 * which reads as a glitch rather than as a note opening.
 *
 * The strip is one stop in the page's tab order, not one per note. Arrow keys
 * move between notes from there, which is what `role="tablist"` promises and
 * what keeps a dozen open notes from burying the editor behind Tab presses.
 */
export function TabStrip({
	tabs,
	activeTabId,
	onActivate,
	onClose,
}: TabStripProps) {
	const stripRef = useRef<HTMLDivElement | null>(null);

	const focusTabAt = (index: number) => {
		const buttons =
			stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
		buttons?.[index]?.focus();
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const at = tabs.findIndex((tab) => tab.id === activeTabId);
		if (at < 0) return;
		const target =
			event.key === "ArrowLeft"
				? (at - 1 + tabs.length) % tabs.length
				: event.key === "ArrowRight"
					? (at + 1) % tabs.length
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
		// Closing from the keyboard without having to reach the button, which is
		// deliberately outside the tab order.
		if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault();
			onClose(tabs[at].id);
		}
	};

	if (tabs.length === 0) return null;
	return (
		<div
			ref={stripRef}
			role="tablist"
			aria-label="Open notes"
			onKeyDown={onKeyDown}
			className="flex shrink-0 items-stretch gap-px overflow-x-auto border-border border-b bg-background"
		>
			{tabs.map((tab) => {
				const active = tab.id === activeTabId;
				return (
					<div
						key={tab.id}
						className={cn(
							"group flex min-w-0 items-center gap-1 border-transparent border-b-2 pr-1 pl-3",
							active ? "border-foreground bg-accent/40" : "hover:bg-accent/20",
						)}
					>
						<button
							type="button"
							role="tab"
							aria-selected={active}
							// Roving focus: only the open note is a tab stop, so the strip
							// costs one Tab press rather than one per note.
							tabIndex={active ? 0 : -1}
							title={tab.title}
							onClick={() => onActivate(tab.id)}
							// Middle-click closes, matching every other tabbed editor.
							onAuxClick={(event) => {
								if (event.button !== 1) return;
								event.preventDefault();
								onClose(tab.id);
							}}
							className={cn(
								"max-w-48 truncate py-1.5 text-sm",
								active ? "text-foreground" : "text-muted-foreground",
							)}
						>
							{tab.label}
						</button>
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
							<MingcuteCloseLine className="size-3.5" />
						</button>
					</div>
				);
			})}
		</div>
	);
}
