import { describe, expect, it } from "vitest";
import { wordRangeAtOffset } from "./ContextMenuSpellcheckExtension";

describe("wordRangeAtOffset", () => {
	it("selects the word before a caret at its end", () => {
		expect(wordRangeAtOffset("This is amzing", 14)).toEqual({
			from: 8,
			to: 14,
		});
	});

	it("selects the word containing the caret", () => {
		expect(wordRangeAtOffset("This is amzing", 10)).toEqual({
			from: 8,
			to: 14,
		});
	});

	it("supports Unicode letters and apostrophes", () => {
		expect(wordRangeAtOffset("naïve l’école", 13)).toEqual({ from: 6, to: 13 });
		expect(wordRangeAtOffset("a𐐷b", 3)).toEqual({ from: 0, to: 4 });
	});

	it("does not cross whitespace", () => {
		expect(wordRangeAtOffset("one  two", 4)).toBeNull();
	});
});
