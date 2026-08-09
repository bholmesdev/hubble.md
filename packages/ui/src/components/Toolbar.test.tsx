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
		dispatchPointer(button, "pointerup", { screenX: 20, screenY: 25 });
		act(() => button.click());

		expect(onMoveWindow).toHaveBeenCalledWith(110, 205);
		expect(document.querySelector("input")).toBeNull();
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
