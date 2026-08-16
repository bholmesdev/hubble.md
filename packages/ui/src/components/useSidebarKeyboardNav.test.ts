// @vitest-environment happy-dom

import {
	act,
	createElement,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useRef,
} from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarKeyboardNav } from "./useSidebarKeyboardNav";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const roots: Root[] = [];

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	document.body.replaceChildren();
});

describe("useSidebarKeyboardNav", () => {
	it("advances on repeated arrow keys before a render", () => {
		const onNavigate = vi.fn();
		let onKeyDown: ((event: ReactKeyboardEvent) => void) | undefined;
		const root = createRoot(
			document.body.appendChild(document.createElement("div")),
		);
		roots.push(root);

		function Harness() {
			const navRef = useRef<HTMLDivElement>(null);
			onKeyDown = useSidebarKeyboardNav({
				items: ["a", "b", "c"],
				onSelect: vi.fn(),
				onNavigate,
				navRef,
				getItemKey: (item) => item,
			}).onKeyDown;
			return createElement("div", { ref: navRef });
		}

		act(() => root.render(createElement(Harness)));
		const handleKeyDown = onKeyDown;
		if (!handleKeyDown) throw new Error("Expected keyboard handler");

		act(() => {
			handleKeyDown(keyEvent("ArrowDown"));
			handleKeyDown(keyEvent("ArrowDown"));
		});

		expect(onNavigate.mock.calls).toEqual([["a"], ["b"]]);
	});

	it("keeps focus on the same item after rows reorder", () => {
		const onSelect = vi.fn();
		let items = ["a", "b", "c"];
		let nav: ReturnType<typeof useSidebarKeyboardNav<string>> | undefined;
		const root = createRoot(
			document.body.appendChild(document.createElement("div")),
		);
		roots.push(root);

		function Harness() {
			const navRef = useRef<HTMLDivElement>(null);
			nav = useSidebarKeyboardNav({
				items,
				onSelect,
				navRef,
				getItemKey: (item) => item,
			});
			return createElement("div", { ref: navRef });
		}

		act(() => root.render(createElement(Harness)));
		act(() => nav?.setFocusedIndex(1));
		items = ["b", "a", "c"];
		act(() => root.render(createElement(Harness)));
		act(() => nav?.onKeyDown(keyEvent("Enter")));

		expect(nav?.focusedIndex).toBe(0);
		expect(onSelect).toHaveBeenCalledWith("b");
	});
});

function keyEvent(key: string) {
	return {
		key,
		preventDefault: vi.fn(),
		target: document.createElement("div"),
	} as unknown as ReactKeyboardEvent;
}
