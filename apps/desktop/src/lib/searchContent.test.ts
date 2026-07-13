import { describe, expect, it } from "vitest";
import { findMatchesInContent } from "./searchContent";

/** The excerpt slice that the UI will emphasize, for offset assertions. */
function highlighted(excerpt: string, start: number, end: number) {
	return excerpt.slice(start, end);
}

describe("findMatchesInContent", () => {
	it("returns 1-indexed line numbers", () => {
		const matches = findMatchesInContent("alpha\nbeta\ngamma", "beta");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(2);
	});

	it("matches case-insensitively", () => {
		const matches = findMatchesInContent("The Pagefind Reference", "pagefind");
		expect(matches).toHaveLength(1);
		expect(highlighted(matches[0].excerpt, ...offsets(matches[0]))).toBe(
			"Pagefind",
		);
	});

	it("keeps the whole line when it fits in the context window", () => {
		const matches = findMatchesInContent("hello world", "world");
		expect(matches[0].excerpt).toBe("hello world");
		expect(highlighted(matches[0].excerpt, ...offsets(matches[0]))).toBe(
			"world",
		);
	});

	it("windows long lines and marks the clipped sides with ellipses", () => {
		const line = `${"a".repeat(100)}needle${"b".repeat(100)}`;
		const [match] = findMatchesInContent(line, "needle", 3, 10);
		expect(match.excerpt).toBe(`…${"a".repeat(10)}needle${"b".repeat(10)}…`);
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("needle");
	});

	it("does not add a leading ellipsis when the window reaches the line start", () => {
		const [match] = findMatchesInContent(
			`needle${"b".repeat(100)}`,
			"needle",
			3,
			10,
		);
		expect(match.excerpt.startsWith("needle")).toBe(true);
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("needle");
	});

	it("keeps offsets correct when leading indentation is trimmed", () => {
		const [match] = findMatchesInContent(
			"\t\t   indented needle here",
			"needle",
		);
		expect(match.excerpt).toBe("indented needle here");
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("needle");
	});

	it("keeps offsets correct for a match at the very end of a line", () => {
		const [match] = findMatchesInContent("trailing needle   ", "needle");
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("needle");
	});

	it("strips bold and italic markers while keeping highlight offsets", () => {
		const [match] = findMatchesInContent(
			"Before **bold** and _italic_ after",
			"italic",
		);
		expect(match.excerpt).toBe("Before bold and italic after");
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("italic");
	});

	it("strips inline code backticks", () => {
		const [match] = findMatchesInContent("Run `pnpm test` now", "pnpm");
		expect(match.excerpt).toBe("Run pnpm test now");
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("pnpm");
	});

	it("replaces link syntax with link text", () => {
		const [match] = findMatchesInContent(
			"Read the [search guide](https://example.com/search)",
			"search guide",
		);
		expect(match.excerpt).toBe("Read the search guide");
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("search guide");
	});

	it("keeps intra-word underscores, so snake_case stays searchable", () => {
		const [match] = findMatchesInContent(
			"rename snake_case_name in _this_ file",
			"snake_case_name",
		);
		expect(match.excerpt).toBe("rename snake_case_name in this file");
		expect(highlighted(match.excerpt, ...offsets(match))).toBe(
			"snake_case_name",
		);
	});

	it("keeps a lone asterisk that never closes", () => {
		const [match] = findMatchesInContent("compute 2 * 3 first", "2 * 3");
		expect(match.excerpt).toBe("compute 2 * 3 first");
	});

	it("matches text that was enclosed by markdown markers", () => {
		const [match] = findMatchesInContent("**bold text**", "bold text");
		expect(match.excerpt).toBe("bold text");
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("bold text");
	});

	it("tolerates CRLF line endings", () => {
		const [match] = findMatchesInContent("one\r\nneedle here\r\n", "needle");
		expect(match.line).toBe(2);
		expect(highlighted(match.excerpt, ...offsets(match))).toBe("needle");
	});

	it("reports at most one match per line, and caps matches per file", () => {
		const content = "needle needle\nneedle\nneedle\nneedle";
		expect(findMatchesInContent(content, "needle", 3)).toHaveLength(3);
	});

	it("returns nothing for a blank query", () => {
		expect(findMatchesInContent("anything", "   ")).toEqual([]);
		expect(findMatchesInContent("anything", "")).toEqual([]);
	});

	it("returns nothing when the needle is absent", () => {
		expect(findMatchesInContent("alpha\nbeta", "gamma")).toEqual([]);
	});
});

function offsets(match: { matchStart: number; matchEnd: number }) {
	return [match.matchStart, match.matchEnd] as const;
}
