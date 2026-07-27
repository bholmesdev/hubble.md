import { describe, expect, it, vi } from "vitest";
import { visitActiveLink } from "./LinkPopover";

describe("visitActiveLink", () => {
	it("passes explicit wiki target extensions through unchanged", async () => {
		const onOpenWikiLink = vi.fn();

		await visitActiveLink(
			{ href: "manual.pdf", kind: "wiki", target: "manual.pdf" },
			vi.fn(),
			onOpenWikiLink,
		);

		expect(onOpenWikiLink).toHaveBeenCalledWith("manual.pdf");
	});
});
