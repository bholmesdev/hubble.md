// @vitest-environment happy-dom
import { act, useState } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot’s render/unmount surface.
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ResizableSidebar } from "./ResizableSidebar";

it.each([
	"left",
	"right",
] as const)("previews and cancels collapse before committing at the %s window edge", async (side) => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const collapse = vi.fn();
	const commit = vi.fn();
	function Panel() {
		const [width, setWidth] = useState(360);
		const [closed, setClosed] = useState(false);
		return closed ? (
			<output>Closed</output>
		) : (
			<ResizableSidebar
				side={side}
				width={width}
				minWidth={200}
				maxWidth={600}
				resizeLabel="Resize panel"
				onWidthChange={setWidth}
				onCollapse={() => {
					collapse();
					setClosed(true);
				}}
				onCommit={commit}
			>
				Contents
			</ResizableSidebar>
		);
	}
	try {
		await act(async () => root.render(<Panel />));
		const panel = host.querySelector("aside");
		const handle = host.querySelector<HTMLElement>('[role="separator"]');
		if (!panel || !handle) throw new Error("Missing panel");
		vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
			left: side === "left" ? 0 : window.innerWidth - 360,
			right: side === "left" ? 360 : window.innerWidth,
		} as DOMRect);
		Object.assign(handle, {
			setPointerCapture: vi.fn(),
			hasPointerCapture: vi.fn(() => true),
			releasePointerCapture: vi.fn(),
		});
		const x = (distance: number) =>
			side === "left" ? distance : window.innerWidth - distance;
		const pointer = async (type: string, distance: number) =>
			act(async () => {
				handle.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						pointerId: 1,
						clientX: x(distance),
					}),
				);
			});
		await pointer("pointerdown", 360);
		await pointer("pointermove", 10);
		expect(collapse).not.toHaveBeenCalled();
		await pointer("pointermove", 300);
		await pointer("pointerup", 300);
		expect(collapse).not.toHaveBeenCalled();
		expect(handle.getAttribute("aria-valuenow")).toBe("300");
		expect(commit).toHaveBeenCalledTimes(1);
		await pointer("pointerdown", 300);
		await pointer("pointermove", 10);
		expect(collapse).not.toHaveBeenCalled();
		await pointer("pointerup", 10);
		expect(collapse).toHaveBeenCalledTimes(1);
		expect(commit).toHaveBeenCalledTimes(1);
		expect(host.textContent).toBe("Closed");
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
