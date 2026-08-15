// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabStrip, type TabStripProps } from "./TabStrip";

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
	vi.restoreAllMocks();
});

function renderStrip(props: Partial<TabStripProps> = {}) {
	const onActivate = vi.fn();
	const onClose = vi.fn();
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container) as Root;
	roots.push(root);
	act(() =>
		root.render(
			<TabStrip
				tabs={[
					{ id: "a", label: "plan", title: "/w/plan.md" },
					{ id: "b", label: "notes", title: "/w/notes.md" },
				]}
				activeTabId="a"
				onActivate={onActivate}
				onClose={onClose}
				{...props}
			/>,
		),
	);
	return { onActivate, onClose };
}

const tabs = () => [...document.querySelectorAll<HTMLElement>("[role=tab]")];

describe("TabStrip", () => {
	it("shows from the first note, so the editor never shifts", () => {
		renderStrip({ tabs: [{ id: "a", label: "plan", title: "/w/plan.md" }] });

		expect(document.querySelector("[role=tablist]")).not.toBeNull();
		expect(tabs()).toHaveLength(1);
	});

	it("renders nothing when no note is open", () => {
		renderStrip({ tabs: [], activeTabId: null });

		expect(document.querySelector("[role=tablist]")).toBeNull();
	});

	it("marks the active tab and reports activation", () => {
		const { onActivate } = renderStrip();

		expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual([
			"true",
			"false",
		]);

		act(() => tabs()[1].click());

		expect(onActivate).toHaveBeenCalledWith("b");
	});

	it("costs one tab stop, not one per note", () => {
		renderStrip();

		expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1]);
		// The close buttons are reachable by mouse and by Delete, but they must
		// not sit between the strip and the editor in the tab order.
		expect(
			[...document.querySelectorAll<HTMLElement>("[aria-label^='Close ']")].map(
				(button) => button.tabIndex,
			),
		).toEqual([-1, -1]);
	});

	it("moves between notes with the arrow keys and wraps", () => {
		const { onActivate } = renderStrip();

		const press = (key: string) =>
			act(() => {
				tabs()[0].dispatchEvent(
					new KeyboardEvent("keydown", { key, bubbles: true }),
				);
			});

		press("ArrowRight");
		expect(onActivate).toHaveBeenLastCalledWith("b");
		press("ArrowLeft");
		expect(onActivate).toHaveBeenLastCalledWith("b");
		press("End");
		expect(onActivate).toHaveBeenLastCalledWith("b");
		press("Home");
		expect(onActivate).toHaveBeenLastCalledWith("a");
	});

	it("closes the open note on Delete", () => {
		const { onClose } = renderStrip();

		act(() => {
			tabs()[0].dispatchEvent(
				new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
			);
		});

		expect(onClose).toHaveBeenCalledWith("a");
	});

	it("closes from the button and from a middle click", () => {
		const { onClose, onActivate } = renderStrip();

		const close = document.querySelector<HTMLElement>(
			"[aria-label='Close notes']",
		);
		act(() => close?.click());
		expect(onClose).toHaveBeenCalledWith("b");

		act(() => {
			tabs()[0].dispatchEvent(
				new MouseEvent("auxclick", { bubbles: true, button: 1 }),
			);
		});
		expect(onClose).toHaveBeenLastCalledWith("a");
		// Middle-clicking closes without also switching to the tab.
		expect(onActivate).not.toHaveBeenCalled();
	});
});
