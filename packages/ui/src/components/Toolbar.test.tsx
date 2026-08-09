// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "./Toolbar";

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
	vi.useRealTimers();
});

describe("Toolbar", () => {
	it("edits the title on click", () => {
		renderToolbar();

		act(() => titleButton().click());

		const input = document.querySelector("input");
		expect(input).toBeInstanceOf(HTMLInputElement);
		expect((input as HTMLInputElement).value).toBe("note.md");
	});

	it("moves the window from the title without starting rename", () => {
		const onMoveWindow = vi.fn();
		let frame: FrameRequestCallback | undefined;
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frame = callback;
			return 1;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
			frame = undefined;
		});
		renderToolbar({ onMoveWindow });
		Object.defineProperty(window, "screenX", {
			value: 100,
			configurable: true,
		});
		Object.defineProperty(window, "screenY", {
			value: 200,
			configurable: true,
		});

		const button = titleButton();
		button.setPointerCapture = vi.fn();

		dispatchPointer(button, "pointerdown", { screenX: 10, screenY: 20 });
		dispatchPointer(button, "pointermove", { screenX: 12, screenY: 21 });
		expect(onMoveWindow).not.toHaveBeenCalled();

		dispatchPointer(button, "pointermove", { screenX: 20, screenY: 25 });
		dispatchPointer(button, "pointermove", { screenX: 24, screenY: 28 });
		expect(onMoveWindow).not.toHaveBeenCalled();
		act(() => frame?.(0));
		dispatchPointer(button, "pointerup", { screenX: 24, screenY: 28 });
		act(() => button.click());

		expect(onMoveWindow).toHaveBeenCalledTimes(1);
		expect(onMoveWindow).toHaveBeenCalledWith(114, 208);
		expect(document.querySelector("input")).toBeNull();
	});

	it("does not suppress a later title click after a cancelled drag", () => {
		vi.useFakeTimers();
		renderToolbar({ onMoveWindow: vi.fn() });
		const button = titleButton();
		button.setPointerCapture = vi.fn();

		dispatchPointer(button, "pointerdown", { screenX: 10, screenY: 20 });
		dispatchPointer(button, "pointermove", { screenX: 20, screenY: 25 });
		dispatchPointer(button, "pointercancel", { screenX: 20, screenY: 25 });
		act(() => vi.runAllTimers());
		act(() => button.click());

		expect(document.querySelector("input")).toBeInstanceOf(HTMLInputElement);
	});
});

function renderToolbar({
	onMoveWindow,
}: {
	onMoveWindow?: (x: number, y: number) => void;
} = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => {
		root.render(
			<Toolbar
				currentPath="/workspace/note.md"
				sidebarOpen={false}
				onRenameCurrentPath={() => {}}
				onMoveWindow={onMoveWindow}
			/>,
		);
	});
}

function titleButton() {
	const button = document.querySelector("button");
	if (!button) throw new Error("Missing title button");
	return button;
}

function dispatchPointer(
	target: Element,
	type: string,
	init: PointerEventInit,
) {
	act(() => {
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				button: 0,
				pointerId: 1,
				...init,
			}),
		);
	});
}
