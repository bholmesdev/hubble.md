import { describe, expect, it } from "vitest";
import { buildReviewAgentPrompt } from "./ReviewCommentPopover";

describe("buildReviewAgentPrompt", () => {
	it("includes enough context for an agent to address a file-backed comment", () => {
		expect(
			buildReviewAgentPrompt({
				filePath: "/notes/plan.md",
				commentId: "c7",
				anchorText: "the launch plan",
				commentBody: "Please make this more concise.",
			}),
		).toContain(
			"Address Hubble review comment c7 in /notes/plan.md.\n\nAnchored text:\nthe launch plan\n\nComment:\nPlease make this more concise.",
		);
	});
});
