import { describe, expect, it } from "vitest";
import { captureTitleFromMarkdown } from "./titleFromMarkdown";

describe("captureTitleFromMarkdown", () => {
	it("uses the first meaningful markdown text", () => {
		expect(captureTitleFromMarkdown("\n# Capture title\n\nSecond line")).toBe(
			"Capture title",
		);
	});

	it("keeps link text and drops URLs", () => {
		expect(
			captureTitleFromMarkdown(
				"[Hubble](https://hubble.md) https://example.com",
			),
		).toBe("Hubble");
	});

	it("treats YAML-looking scratch text as note content", () => {
		expect(captureTitleFromMarkdown("---\ntitle: Keep me\n---\nBody")).toBe(
			"title: Keep me",
		);
	});

	it("caps generated titles", () => {
		expect(captureTitleFromMarkdown("a".repeat(60))).toHaveLength(40);
	});
});
