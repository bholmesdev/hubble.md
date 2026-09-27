import { describe, expect, it } from "vitest";
import { shouldShowFooterDivider } from "./scrollOverflow";

function box(metrics: {
	clientHeight?: number;
	scrollHeight?: number;
	scrollTop?: number;
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
