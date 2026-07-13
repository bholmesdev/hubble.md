import { describe, expect, it } from "vitest";
import { matchRanges, scorePath, scoreText } from "./fuzzy";

/** The characters the palette would emphasize, for range assertions. */
function emphasized(query: string, haystack: string) {
	return matchRanges(query, haystack)
		.map(([start, end]) => haystack.slice(start, end))
		.join("|");
}

describe("scoreText", () => {
	it("ranks exact above prefix above substring above subsequence", () => {
		expect(scoreText("notes", "notes")).toBe(1);
		expect(scoreText("note", "notes")).toBe(0.9);
		expect(scoreText("ote", "notes")).toBe(0.75);
		expect(scoreText("nts", "notes")).toBe(0.45);
		expect(scoreText("zzz", "notes")).toBe(0);
	});

	it("ignores case and separator characters on both sides", () => {
		expect(scoreText("MeetingNotes", "meeting-notes")).toBe(1);
		expect(scoreText("meeting notes", "Meeting_Notes")).toBe(1);
	});

	it("treats an empty query as a match", () => {
		expect(scoreText("", "anything")).toBe(1);
	});
});

describe("scorePath", () => {
	it("prefers a file-name hit over a parent-folder hit", () => {
		expect(scorePath("report", "notes/report.md")).toBeGreaterThan(
			scorePath("report", "report/notes.md"),
		);
	});

	it("still matches when the query only appears in a parent folder", () => {
		expect(scorePath("archive", "archive/2024/notes.md")).toBeGreaterThan(0);
	});

	it("keeps path separators significant, so they are not matched through", () => {
		// "notesmd" is a subsequence of "notes/report.md" only if `/` is skipped.
		expect(scoreText("notes/report.md", "notes/report.md")).toBe(1);
	});
});

describe("matchRanges", () => {
	it("marks a contiguous substring match", () => {
		expect(emphasized("note", "meeting-notes.md")).toBe("note");
	});

	it("marks scattered characters for a subsequence match", () => {
		expect(emphasized("mtg", "meeting.md")).toBe("m|t|g");
	});

	it("maps back through skipped separators in the haystack", () => {
		expect(emphasized("meetingnotes", "meeting-notes.md")).toBe(
			"meeting|notes",
		);
	});

	it("is case-insensitive but returns original-cased slices", () => {
		expect(emphasized("pagefind", "Pagefind.md")).toBe("Pagefind");
	});

	it("returns no ranges for an empty query or a non-match", () => {
		expect(matchRanges("", "notes.md")).toEqual([]);
		expect(matchRanges("zzz", "notes.md")).toEqual([]);
	});
});
