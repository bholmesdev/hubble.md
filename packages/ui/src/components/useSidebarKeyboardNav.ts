import { type RefObject, useEffect, useRef, useState } from "react";
import { isEditableEventTarget } from "../lib/dom";

export const EDITOR_INPUT_SELECTOR = "[data-editor-input]";

export function useSidebarKeyboardNav<T>({
	items,
	onSelect,
	onEnter,
	onExpand,
	onCollapse,
	navRef,
	activeIndex = -1,
	onNavigate,
}: {
	items: T[];
	onSelect: (item: T) => void;
	onEnter?: (item: T) => void;
	onExpand?: (item: T) => void;
	onCollapse?: (item: T) => void;
	navRef: RefObject<HTMLElement | null>;
	activeIndex?: number;
	onNavigate?: (item: T) => void;
}) {
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const focusedIndexRef = useRef(focusedIndex);
	focusedIndexRef.current = focusedIndex;
	const getActionIndex = () =>
		focusedIndexRef.current ?? (activeIndex >= 0 ? activeIndex : null);

	useEffect(() => {
		if (focusedIndex === null) return;
		navRef.current
			?.querySelector(`[data-sidebar-index="${focusedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [focusedIndex, navRef]);

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (items.length === 0) return;
		if (isEditableEventTarget(event.target)) return;

		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				const start =
					focusedIndexRef.current ?? (activeIndex >= 0 ? activeIndex : -1);
				const next = Math.max(0, Math.min(start + delta, items.length - 1));
				focusedIndexRef.current = next;
				setFocusedIndex(next);
				if (items[next]) onNavigate?.(items[next]);
				break;
			}
			case "Enter": {
				const idx = getActionIndex();
				if (idx !== null && items[idx]) {
					event.preventDefault();
					(onEnter ?? onSelect)(items[idx]);
				}
				break;
			}
			case " ": {
				const idx = getActionIndex();
				if (idx !== null && items[idx]) {
					event.preventDefault();
					onSelect(items[idx]);
				}
				break;
			}
			case "ArrowRight": {
				const idx = getActionIndex();
				if (idx !== null && items[idx] && onExpand) {
					event.preventDefault();
					onExpand(items[idx]);
				}
				break;
			}
			case "ArrowLeft": {
				const idx = getActionIndex();
				if (idx !== null && items[idx] && onCollapse) {
					event.preventDefault();
					onCollapse(items[idx]);
				}
				break;
			}
			case "Escape": {
				event.preventDefault();
				focusedIndexRef.current = null;
				setFocusedIndex(null);
				document.querySelector<HTMLElement>(EDITOR_INPUT_SELECTOR)?.focus();
				break;
			}
		}
	};

	return { focusedIndex, setFocusedIndex, onKeyDown };
}
