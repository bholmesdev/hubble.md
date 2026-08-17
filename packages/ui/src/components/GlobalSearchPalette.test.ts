import { describe, expect, it } from "vitest";
import {
	getNameResults,
	type PaletteFile,
	rankContentResults,
} from "./GlobalSearchPalette";

const files: PaletteFile[] = [
	{
		path: "/vault/templates/plan.md",
		relativePath: "templates/plan.md",
		modifiedAt: 30,
		isTemplate: true,
	},
	{
		path: "/vault/plan.md",
		relativePath: "plan.md",
		modifiedAt: 10,
	},
	{
		path: "/vault/notes/plan.md",
		relativePath: "notes/plan.md",
		modifiedAt: 20,
	},
];

describe("GlobalSearchPalette ranking", () => {
	it("ranks ordinary notes above equally relevant templates by name", () => {
		expect(getNameResults(files, "plan").map((file) => file.path)).toEqual([
			"/vault/notes/plan.md",
			"/vault/plan.md",
			"/vault/templates/plan.md",
		]);
	});

	it("keeps modification time as the tie-break within ordinary notes", () => {
		expect(getNameResults(files, "").map((file) => file.path)).toEqual([
			"/vault/notes/plan.md",
			"/vault/plan.md",
			"/vault/templates/plan.md",
		]);
	});

	it("ranks ordinary notes above templates for content matches", () => {
		const results = rankContentResults(
			[
				{ path: "/vault/templates/plan.md", matches: [] },
				{ path: "/vault/plan.md", matches: [] },
				{ path: "/vault/notes/plan.md", matches: [] },
			],
			files,
		);

		expect(results.map((result) => result.path)).toEqual([
			"/vault/notes/plan.md",
			"/vault/plan.md",
			"/vault/templates/plan.md",
		]);
	});
});
