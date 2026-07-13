import type { SearchContentMatch } from "../desktopApi/types";

export const SEARCH_MIN_QUERY_LENGTH = 3;
export const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const SEARCH_MAX_RESULT_FILES = 50;
export const SEARCH_MAX_MATCHES_PER_FILE = 3;
export const SEARCH_CONCURRENCY = 8;
export const SEARCH_EXCERPT_CONTEXT_CHARS = 40;

function stripInlineMarkdown(line: string) {
	return (
		line
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/`+([^`]*)`+/g, "$1")
			// Markers strip only when they could open and close emphasis: no space
			// just inside the pair, and for underscores no word character just
			// outside, so snake_case and stray asterisks in prose stay searchable.
			.replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, "$1")
			.replace(/\*(?!\s)([^*]+?)(?<!\s)\*/g, "$1")
			.replace(/(?<!\w)__(?!\s)([^_]+?)(?<!\s)__(?!\w)/g, "$1")
			.replace(/(?<!\w)_(?!\s)([^_]+?)(?<!\s)_(?!\w)/g, "$1")
	);
}

/**
 * Literal, case-insensitive line matching with a windowed excerpt.
 *
 * Deliberately not a regex: user input would need escaping anyway, and a regex
 * dialect is a promise we do not want to make for an MVP search box.
 */
export function findMatchesInContent(
	content: string,
	query: string,
	maxMatches = SEARCH_MAX_MATCHES_PER_FILE,
	contextChars = SEARCH_EXCERPT_CONTEXT_CHARS,
): SearchContentMatch[] {
	const needle = query.toLowerCase();
	if (needle.trim() === "") return [];

	const matches: SearchContentMatch[] = [];
	const lines = content.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		if (matches.length >= maxMatches) break;
		const line = stripInlineMarkdown(lines[index].replace(/\r$/, ""));
		const at = line.toLowerCase().indexOf(needle);
		if (at === -1) continue;

		const windowStart = Math.max(0, at - contextChars);
		const windowEnd = Math.min(line.length, at + needle.length + contextChars);
		const windowed = line.slice(windowStart, windowEnd);

		// Trim only outside the match: leading whitespace sits before the match
		// and trailing whitespace after it, so neither trim can eat into it.
		const leading = windowed.length - windowed.trimStart().length;
		const trimmed = windowed.trim();
		const prefix = windowStart > 0 ? "…" : "";
		const suffix = windowEnd < line.length ? "…" : "";

		const matchStart = at - windowStart - leading + prefix.length;
		matches.push({
			line: index + 1,
			excerpt: `${prefix}${trimmed}${suffix}`,
			matchStart,
			matchEnd: matchStart + needle.length,
		});
	}
	return matches;
}
