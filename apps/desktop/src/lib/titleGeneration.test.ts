import { describe, expect, it } from "vitest";
import { generatedTitleStem } from "./titleGeneration";

describe("generatedTitleStem", () => {
	it("slugs the first meaningful line", () => {
		expect(generatedTitleStem("\n# Don't Panic!\nSecond line")).toBe(
			"dont-panic",
		);
	});

	it("skips links and image alts", () => {
		expect(
			generatedTitleStem(
				"![Hero image](hero.png)\n[Hubble](https://hubble.md)\nActual title",
			),
		).toBe("actual-title");
		expect(generatedTitleStem("Read [this](https://example.com) today")).toBe(
			"read-today",
		);
	});

	it("ignores front matter", () => {
		expect(
			generatedTitleStem("---\ntitle: Metadata\n---\n\nVisible title"),
		).toBe("visible-title");
	});

	it("caps the slug at 40 characters", () => {
		const stem = generatedTitleStem(`${"word ".repeat(20)}ending`);
		expect(stem?.length).toBeLessThanOrEqual(40);
		expect(stem?.endsWith("-")).toBe(false);
	});

	it("returns null when no meaningful text remains", () => {
		expect(
			generatedTitleStem("![Alt](image.png)\nhttps://example.com"),
		).toBeNull();
	});
});
