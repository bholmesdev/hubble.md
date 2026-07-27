import { describe, expect, it } from "vitest";
import {
	dirname,
	duplicateBasenames,
	fileKindForPath,
	hasDocumentExtension,
	hasImageExtension,
	isCodeFile,
	isHiddenSidebarFolderName,
	isVisibleSidebarFileName,
	relativeWorkspacePath,
	sourceLanguageForPath,
	supportsSourceToggle,
} from "./filePath";

describe("dirname", () => {
	it("preserves Windows drive roots", () => {
		expect(dirname("C:/index.html")).toBe("C:/");
		expect(dirname("C:\\index.html")).toBe("C:\\");
	});
});

describe("duplicateBasenames", () => {
	it("finds duplicate folder names across path separators", () => {
		expect(
			duplicateBasenames([
				"/projects/alpha/plans",
				"/projects/notes",
				"C:\\projects\\beta\\plans",
			]),
		).toEqual(new Set(["plans"]));
	});
});

describe("supported workspace files", () => {
	it("recognizes browser-viewable images", () => {
		expect(hasImageExtension("photo.JPEG")).toBe(true);
		expect(hasImageExtension("diagram.svg")).toBe(true);
		expect(hasImageExtension("photo.heic")).toBe(false);
	});

	it("recognizes code extensions and conventional filenames", () => {
		expect(isCodeFile("app.tsx")).toBe(true);
		expect(isCodeFile("types.d.ts")).toBe(true);
		expect(isCodeFile("Dockerfile")).toBe(true);
		expect(isCodeFile("LICENSE")).toBe(false);
	});

	it("maps code paths to syntax languages", () => {
		expect(sourceLanguageForPath("app.tsx")).toBe("tsx");
		expect(sourceLanguageForPath("script.py")).toBe("python");
		expect(sourceLanguageForPath("Dockerfile")).toBe("bash");
	});

	it("keeps source toggles limited to rich-view files", () => {
		expect(supportsSourceToggle("note.md")).toBe(true);
		expect(supportsSourceToggle("notes.txt")).toBe(true);
		expect(supportsSourceToggle("app.ts")).toBe(false);
		expect(supportsSourceToggle("CMakeLists.txt")).toBe(false);
	});
});

describe("hasDocumentExtension", () => {
	it("matches files with rich and source viewer modes", () => {
		expect(hasDocumentExtension("note.md")).toBe(true);
		expect(hasDocumentExtension("app.html")).toBe(true);
		expect(hasDocumentExtension("app.HTM")).toBe(true);
		expect(hasDocumentExtension("image.png")).toBe(false);
	});
});

describe("fileKindForPath", () => {
	it("distinguishes editable, viewer, and external files", () => {
		expect(fileKindForPath("note.md")).toBe("document");
		expect(fileKindForPath("notes.TXT")).toBe("document");
		expect(fileKindForPath("notes.text")).toBe("document");
		expect(fileKindForPath("app.ts")).toBe("document");
		expect(fileKindForPath("manual.PDF")).toBe("viewer");
		expect(fileKindForPath("image.png")).toBe("viewer");
		expect(fileKindForPath("LICENSE")).toBe("external");
	});
});

describe("isHiddenSidebarFolderName", () => {
	it("matches app-owned directories excluded from the sidebar", () => {
		expect(isHiddenSidebarFolderName(".hubble")).toBe(true);
		expect(isHiddenSidebarFolderName("note.assets")).toBe(true);
		expect(isHiddenSidebarFolderName("note.assets.backup")).toBe(false);
		expect(isHiddenSidebarFolderName("assets")).toBe(false);
	});
});

describe("isVisibleSidebarFileName", () => {
	it("hides dotfiles without hiding ordinary files", () => {
		expect(isVisibleSidebarFileName(".env")).toBe(false);
		expect(isVisibleSidebarFileName("manual.pdf")).toBe(true);
	});
});

describe("relativeWorkspacePath", () => {
	it("returns an empty path for the workspace root", () => {
		expect(relativeWorkspacePath("/vault", "/vault")).toBe("");
	});
});
