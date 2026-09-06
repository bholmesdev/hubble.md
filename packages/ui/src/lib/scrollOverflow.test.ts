import { describe, expect, it } from "vitest";
import {
	horizontalOverflowEdges,
	shouldShowFooterDivider,
} from "./scrollOverflow";

function box(metrics: {
	clientHeight?: number;
	scrollHeight?: number;
	scrollTop?: number;
	clientWidth?: number;
	scrollWidth?: number;
	scrollLeft?: number;
}) {
	return metrics as HTMLElement;
}

describe("shouldShowFooterDivider", () => {
	it("hides the divider when there is no real overflow", () => {
		expect(
			shouldShowFooterDivider(
				box({ clientHeight: 100, scrollHeight: 104, scrollTop: 0 }),
			),
		).toBe(false);
	});

	it("shows the divider while content continues below", () => {
		expect(
			shouldShowFooterDivider(
				box({ clientHeight: 100, scrollHeight: 200, scrollTop: 0 }),
			),
		).toBe(true);
		expect(
			shouldShowFooterDivider(
				box({ clientHeight: 100, scrollHeight: 200, scrollTop: 99 }),
			),
		).toBe(false);
	});
});

describe("horizontalOverflowEdges", () => {
	it("hides both edges when the strip fits", () => {
		expect(
			horizontalOverflowEdges(
				box({ clientWidth: 200, scrollWidth: 204, scrollLeft: 0 }),
			),
		).toEqual({ start: false, end: false });
	});

	it("marks the end while more tabs sit to the right", () => {
		expect(
			horizontalOverflowEdges(
				box({ clientWidth: 200, scrollWidth: 400, scrollLeft: 0 }),
			),
		).toEqual({ start: false, end: true });
	});

	it("marks the start after scrolling past the first tabs", () => {
		expect(
			horizontalOverflowEdges(
				box({ clientWidth: 200, scrollWidth: 400, scrollLeft: 80 }),
			),
		).toEqual({ start: true, end: true });
	});

	it("drops the end mark at the last tab", () => {
		expect(
			horizontalOverflowEdges(
				box({ clientWidth: 200, scrollWidth: 400, scrollLeft: 199 }),
			),
		).toEqual({ start: true, end: false });
	});
});
