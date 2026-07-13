import { type RefObject, useEffect, useState } from "react";
import { EDITOR_INPUT_SELECTOR } from "../selectors";

export function useSidebarKeyboardNav<T>({
	items,
	onSelect,
	navRef,
	activeIndex = -1,
}: {
	items: T[];
	onSelect: (item: T) => void;
	navRef: RefObject<HTMLElement | null>;
	activeIndex?: number;
}) {
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

	useEffect(() => {
		if (focusedIndex === null) return;
		navRef.current
			?.querySelector(`[data-sidebar-index="${focusedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [focusedIndex, navRef]);

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (items.length === 0) return;

		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				setFocusedIndex((prev) => {
					const start = prev ?? (activeIndex >= 0 ? activeIndex : -1);
					return Math.max(0, Math.min(start + delta, items.length - 1));
				});
				break;
			}
			case "Enter": {
				const idx = focusedIndex ?? (activeIndex >= 0 ? activeIndex : null);
				if (idx !== null && items[idx]) {
					event.preventDefault();
					onSelect(items[idx]);
				}
				break;
			}
			case "Escape": {
				event.preventDefault();
				setFocusedIndex(null);
				document.querySelector<HTMLElement>(EDITOR_INPUT_SELECTOR)?.focus();
				break;
			}
		}
	};

	return { focusedIndex, setFocusedIndex, onKeyDown };
}
