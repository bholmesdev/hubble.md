// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { filePathForTitlePreview } from "./FileInfoBar";

describe("file info title preview", () => {
	it("shows a pending title before its file is renamed", () => {
		expect(
			filePathForTitlePreview("/workspace/draft-2.md", {
				path: "/workspace/draft-2.md",
				previewPath: "/workspace/draft.md",
			}),
		).toBe("/workspace/draft.md");
	});

	it("does not show another tab's pending title", () => {
		expect(
			filePathForTitlePreview("/workspace/notes.md", {
				path: "/workspace/draft-2.md",
				previewPath: "/workspace/draft.md",
			}),
		).toBe("/workspace/notes.md");
	});
});
