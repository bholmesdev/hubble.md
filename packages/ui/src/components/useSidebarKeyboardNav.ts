import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
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
	getItemKey,
}: {
	items: T[];
	onSelect: (item: T) => void;
	onEnter?: (item: T) => void;
	onExpand?: (item: T) => void;
	onCollapse?: (item: T) => void;
	navRef: RefObject<HTMLElement | null>;
	activeIndex?: number;
	onNavigate?: (item: T) => void;
	getItemKey: (item: T) => string | null;
}) {
	const [focusedKey, setFocusedKey] = useState<string | null>(null);
	const focusedIndex =
		focusedKey === null
			? null
			: items.findIndex((item) => getItemKey(item) === focusedKey);
	const currentIndex = focusedIndex === -1 ? null : focusedIndex;
	const focusedKeyRef = useRef(focusedKey);
	useLayoutEffect(() => {
		focusedKeyRef.current = focusedKey;
	}, [focusedKey]);
	useEffect(() => {
		if (focusedIndex === -1) setFocusedKey(null);
	}, [focusedIndex]);
	const focusItem = (item: T | null) => {
		const key = item === null ? null : getItemKey(item);
		focusedKeyRef.current = key;
		setFocusedKey(key);
	};
	const getFocusedIndex = () => {
		const key = focusedKeyRef.current;
		if (key === null) return null;
		const index = items.findIndex((item) => getItemKey(item) === key);
		return index < 0 ? null : index;
	};
	const getActionIndex = () =>
		getFocusedIndex() ?? (activeIndex >= 0 ? activeIndex : null);

	useEffect(() => {
		if (currentIndex === null) return;
		navRef.current
			?.querySelector(`[data-sidebar-index="${currentIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [currentIndex, navRef]);

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (items.length === 0) return;
		if (isEditableEventTarget(event.target)) return;

		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				const start =
					getFocusedIndex() ?? (activeIndex >= 0 ? activeIndex : -1);
				let next = Math.max(0, Math.min(start + delta, items.length - 1));
				while (
					items[next] &&
					getItemKey(items[next]) === null &&
					next + delta >= 0 &&
					next + delta < items.length
				) {
					next += delta;
				}
				const key = items[next] ? getItemKey(items[next]) : null;
				if (key === null) break;
				focusedKeyRef.current = key;
				setFocusedKey(key);
				onNavigate?.(items[next]);
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
				focusedKeyRef.current = null;
				setFocusedKey(null);
				document.querySelector<HTMLElement>(EDITOR_INPUT_SELECTOR)?.focus();
				break;
			}
		}
	};

	return { focusedIndex: currentIndex, focusItem, onKeyDown };
}
