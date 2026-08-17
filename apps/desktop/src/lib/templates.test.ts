import { describe, expect, it } from "vitest";
import {
	cascadingTemplateLibraryPaths,
	discoverTemplateChoices,
	isTemplateLibraryName,
	isTemplatePath,
	owningTemplateLibraryPath,
	resolveDefaultTemplateChoice,
	templateOwnerFolderPath,
} from "./templates";

describe("template path classification", () => {
	it("recognizes case-insensitive template libraries", () => {
		expect(isTemplateLibraryName("templates")).toBe(true);
		expect(isTemplateLibraryName("Templates")).toBe(true);
		expect(isTemplateLibraryName("template")).toBe(false);
	});

	it("treats markdown files recursively inside a template library as templates", () => {
		expect(isTemplatePath("/vault/templates/daily.md")).toBe(true);
		expect(isTemplatePath("/vault/Templates/nested/daily.markdown")).toBe(true);
		expect(isTemplatePath("/vault/templates/image.png")).toBe(false);
		expect(isTemplatePath("/vault/notes/templates.md")).toBe(false);
	});

	it("finds the nearest owning template library", () => {
		expect(
			owningTemplateLibraryPath("/vault/templates/nested/templates/one.md"),
		).toBe("/vault/templates/nested/templates");
	});
});

describe("template library cascade", () => {
	it("walks from the target owner folder to the workspace root", () => {
		expect(
			cascadingTemplateLibraryPaths(
				templateOwnerFolderPath("/vault/notes/meetings/day.md"),
				"/vault",
			),
		).toEqual([
			"/vault/notes/meetings/templates",
			"/vault/notes/templates",
			"/vault/templates",
		]);
	});

	it("uses a template file's library owner while editing templates", () => {
		expect(templateOwnerFolderPath("/vault/notes/templates/current.md")).toBe(
			"/vault/notes",
		);
	});
});

describe("discoverTemplateChoices", () => {
	it("returns nearest-first library-relative choices", () => {
		const choices = discoverTemplateChoices({
			workspacePath: "/vault",
			targetPath: "/vault/notes/meetings/day.md",
			files: [
				{ path: "/vault/templates/journal.md" },
				{ path: "/vault/notes/meetings/templates/main.md" },
				{ path: "/vault/notes/templates/client/brief.md" },
				{ path: "/vault/outside.md" },
				{ path: "/vault/notes/meetings/templates/image.png" },
			],
		});

		expect(choices.map((choice) => choice.label)).toEqual([
			"main",
			"client/brief",
			"journal",
		]);
		expect(choices.map((choice) => choice.libraryRelativePath)).toEqual([
			"main.md",
			"client/brief.md",
			"journal.md",
		]);
	});

	it("keeps same-named templates separate and excludes the current template", () => {
		const choices = discoverTemplateChoices({
			workspacePath: "/vault",
			targetPath: "/vault/notes/templates/main.md",
			files: [
				{ path: "/vault/templates/main.md" },
				{ path: "/vault/notes/templates/main.md" },
				{ path: "/vault/notes/templates/other.md" },
			],
		});

		expect(choices.map((choice) => choice.path)).toEqual([
			"/vault/notes/templates/other.md",
			"/vault/templates/main.md",
		]);
	});

	it("handles Windows separators and workspace casing", () => {
		const choices = discoverTemplateChoices({
			workspacePath: "c:/vault",
			targetPath: "C:\\Vault\\Notes\\Day.md",
			files: [
				{ path: "C:\\Vault\\Templates\\Root.md" },
				{ path: "C:\\Vault\\Notes\\Templates\\Local.md" },
			],
		});

		expect(choices.map((choice) => choice.libraryPath)).toEqual([
			"C:/Vault/Notes/Templates",
			"C:/Vault/Templates",
		]);
	});
});

describe("resolveDefaultTemplateChoice", () => {
	it("chooses the nearest valid default", () => {
		const choices = discoverTemplateChoices({
			workspacePath: "/vault",
			targetPath: "/vault/notes/day.md",
			files: [
				{ path: "/vault/templates/a.md" },
				{ path: "/vault/notes/templates/z.md" },
			],
		});

		expect(resolveDefaultTemplateChoice(choices)?.path).toBe(
			"/vault/notes/templates/z.md",
		);
	});

	it("breaks duplicate defaults by case-insensitive relative path, then case", () => {
		const choices = discoverTemplateChoices({
			workspacePath: "/vault",
			targetPath: "/vault/day.md",
			files: [
				{ path: "/vault/templates/b.md" },
				{ path: "/vault/templates/A.md" },
				{ path: "/vault/templates/a.md" },
			],
		});

		expect(resolveDefaultTemplateChoice(choices)?.path).toBe(
			"/vault/templates/A.md",
		);
	});
});
