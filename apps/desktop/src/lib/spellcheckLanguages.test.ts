import { describe, expect, it } from "vitest";
import { isDefaultLanguage } from "./spellcheckLanguages";

describe("isDefaultLanguage", () => {
	it("accepts one regional variant of the system language", () => {
		expect(isDefaultLanguage(["en-GB"], "en-US")).toBe(true);
	});

	it("rejects a different language", () => {
		expect(isDefaultLanguage(["fr"], "en-US")).toBe(false);
	});

	it("rejects multiple languages including the system language", () => {
		expect(isDefaultLanguage(["en-US", "fr"], "en-US")).toBe(false);
	});
});
