import { describe, expect, it } from "vitest";
import { resolveWikiPath } from "./wikiPath";

describe("resolveWikiPath", () => {
	const files = [
		{ path: "/workspace/note.md", modified_at: 1, kind: "document" as const },
		{ path: "/workspace/manual.pdf", modified_at: 1, kind: "viewer" as const },
	];

	it("resolves explicit non-Markdown targets before adding .md", () => {
		expect(
			resolveWikiPath({
				target: "manual.pdf",
				files,
				workspacePath: "/workspace",
			}),
		).toBe("/workspace/manual.pdf");
	});

	it("keeps extensionless targets on the Markdown fallback", () => {
		expect(
			resolveWikiPath({
				target: "note",
				files,
				workspacePath: "/workspace",
			}),
		).toBe("/workspace/note.md");
	});
});
