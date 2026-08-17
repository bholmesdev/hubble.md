import { describe, expect, it } from "vitest";
import {
	indexMovedFiles,
	pathAfterMove,
	rebaseCopiedMarkdown,
} from "./markdownLinkRewrite";

describe("pathAfterMove", () => {
	it("matches descendants when moved paths use Windows separators", () => {
		const movedByOldPath = indexMovedFiles([
			{
				fromPath: "C:\\workspace\\note.assets",
				toPath: "C:\\workspace\\renamed.assets",
			},
		]);

		expect(
			pathAfterMove("C:/workspace/note.assets/image.png", movedByOldPath),
		).toBe("C:/workspace/renamed.assets/image.png");
	});
});

describe("rebaseCopiedMarkdown", () => {
	it("preserves relative Markdown and HTML targets after a copy", () => {
		const content = [
			"[Plan](../plans/roadmap.md?view=1#now)",
			'<a href="../brief.html">Brief</a>',
			'<img src="template.assets/chart.png">',
		].join("\n");

		expect(
			rebaseCopiedMarkdown({
				content,
				fromPath: "/workspace/templates/template.md",
				toPath: "/workspace/notes/meetings/new-file.md",
				copiedAssets: [
					{
						fromPath: "/workspace/templates/template.assets/chart.png",
						toPath: "/workspace/notes/meetings/new-file.assets/chart-2.png",
					},
				],
			}),
		).toBe(
			[
				"[Plan](../../plans/roadmap.md?view=1#now)",
				'<a href="../../brief.html">Brief</a>',
				'<img src="new-file.assets/chart-2.png">',
			].join("\n"),
		);
	});

	it("leaves absolute, external, anchor, and wikilink targets unchanged", () => {
		const content = [
			"[Web](https://hubble.md)",
			"[Root](/shared/file.md)",
			"[Anchor](#section)",
			"[[projects/roadmap|Roadmap]]",
		].join("\n");

		expect(
			rebaseCopiedMarkdown({
				content,
				fromPath: "/workspace/templates/template.md",
				toPath: "/workspace/notes/new-file.md",
			}),
		).toBe(content);
	});

	it("handles Windows paths and case-insensitive copied asset lookup", () => {
		expect(
			rebaseCopiedMarkdown({
				content: "![Chart](Template.assets/Chart.PNG)",
				fromPath: "C:\\workspace\\templates\\template.md",
				toPath: "C:\\workspace\\notes\\new-file.md",
				copiedAssets: [
					{
						fromPath: "C:\\workspace\\templates\\template.assets\\chart.png",
						toPath: "C:\\workspace\\notes\\new-file.assets\\chart.png",
					},
				],
			}),
		).toBe("![Chart](new-file.assets/chart.png)");
	});
});
