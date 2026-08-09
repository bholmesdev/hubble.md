// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { toolbarPathForTitlePreview } from "./Toolbar";

describe("toolbarPathForTitlePreview", () => {
	it("shows pending previews even when the current name has a numeric suffix", () => {
		expect(
			toolbarPathForTitlePreview("/workspace/draft-2.md", {
				path: "/workspace/draft-2.md",
				previewPath: "/workspace/draft.md",
			}),
		).toBe("/workspace/draft.md");
	});

	it("hides the preview only when it matches the current path", () => {
		expect(
			toolbarPathForTitlePreview("/workspace/draft-2.md", {
				path: "/workspace/draft-2.md",
				previewPath: "/workspace/draft-2.md",
			}),
		).toBe("/workspace/draft-2.md");
	});
});
