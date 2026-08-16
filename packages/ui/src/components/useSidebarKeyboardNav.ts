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
	const focusedKeyRef = useRef(focusedKey);
	useLayoutEffect(() => {
		focusedKeyRef.current = focusedKey;
	}, [focusedKey]);
	const focusedIndex =
		focusedKey === null
			? null
			: items.findIndex((item) => getItemKey(item) === focusedKey);
	const visibleFocusedIndex =
		focusedIndex !== null && focusedIndex >= 0 ? focusedIndex : null;
	const setFocusedIndex = (index: number | null) => {
		const item = index === null ? undefined : items[index];
		const key = item === undefined ? null : getItemKey(item);
		focusedKeyRef.current = key ?? null;
		setFocusedKey(key ?? null);
	};
	useLayoutEffect(() => {
		if (focusedKey !== null && focusedIndex === -1) {
			focusedKeyRef.current = null;
			setFocusedKey(null);
		}
	}, [focusedIndex, focusedKey]);
	const getActionIndex = () =>
		focusedKeyRef.current === null
			? activeIndex >= 0
				? activeIndex
				: null
			: items.findIndex((item) => getItemKey(item) === focusedKeyRef.current);

	useEffect(() => {
		if (visibleFocusedIndex === null) return;
		navRef.current
			?.querySelector(`[data-sidebar-index="${visibleFocusedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [visibleFocusedIndex, navRef]);

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (items.length === 0) return;
		if (isEditableEventTarget(event.target)) return;

		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				const focusedIndex =
					focusedKeyRef.current === null
						? -1
						: items.findIndex(
								(item) => getItemKey(item) === focusedKeyRef.current,
							);
				const start = focusedIndex >= 0 ? focusedIndex : activeIndex;
				let next = Math.max(0, Math.min(start + delta, items.length - 1));
				while (
					items[next] &&
					getItemKey(items[next]) === null &&
					next + delta >= 0 &&
					next + delta < items.length
				) {
					next += delta;
				}
				const item = items[next];
				if (!item || getItemKey(item) === null) break;
				setFocusedIndex(next);
				onNavigate?.(item);
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
				setFocusedIndex(null);
				document.querySelector<HTMLElement>(EDITOR_INPUT_SELECTOR)?.focus();
				break;
			}
		}
	};

	return { focusedIndex: visibleFocusedIndex, setFocusedIndex, onKeyDown };
}
