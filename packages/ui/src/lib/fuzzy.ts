/**
 * Fuzzy scoring for file names and paths, used by the global search palette.
 *
 * The score ladder mirrors the command menus (exact > prefix > substring >
 * subsequence) so ranking feels the same everywhere in the app. Unlike those
 * menus, this module also reports *where* a match landed, so the palette can
 * emphasize the matched characters.
 */

const SEPARATOR_RE = /[\s_-]/;

export type MatchRange = [start: number, end: number];

function normalize(value: string): string {
	return value.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Normalized text plus a map back to indices in the original string.
 *
 * Each entry of `map` must correspond to exactly one original character, so
 * per-character lowercasing is truncated to a single code unit. Locale-exotic
 * expansions (e.g. `İ` → `i̇`) would otherwise desynchronize the map.
 */
function normalizeWithMap(value: string): { text: string; map: number[] } {
	let text = "";
	const map: number[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (SEPARATOR_RE.test(char)) continue;
		text += char.toLowerCase()[0] ?? char;
		map.push(index);
	}
	return { text, map };
}

function isSubsequence(needle: string, haystack: string): boolean {
	let index = 0;
	for (const char of haystack) {
		if (char === needle[index]) index += 1;
		if (index === needle.length) return true;
	}
	return needle.length === 0;
}

/** 1 exact, 0.9 prefix, 0.75 substring, 0.45 subsequence, 0 no match. */
export function scoreText(query: string, haystack: string): number {
	const needle = normalize(query);
	if (!needle) return 1;
	const text = normalize(haystack);
	if (text === needle) return 1;
	if (text.startsWith(needle)) return 0.9;
	if (text.includes(needle)) return 0.75;
	if (isSubsequence(needle, text)) return 0.45;
	return 0;
}

function basename(relativePath: string): string {
	const slash = relativePath.lastIndexOf("/");
	return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

/**
 * A hit on the file name outranks a hit that only exists in a parent folder
 * name, so `notes/report.md` beats `report/notes.md` for the query "report".
 */
export function scorePath(query: string, relativePath: string): number {
	return Math.max(
		scoreText(query, basename(relativePath)),
		0.8 * scoreText(query, relativePath),
	);
}

function toRanges(indices: number[]): MatchRange[] {
	if (indices.length === 0) return [];
	const ranges: MatchRange[] = [];
	let start = indices[0];
	let previous = indices[0];
	for (const index of indices.slice(1)) {
		if (index !== previous + 1) {
			ranges.push([start, previous + 1]);
			start = index;
		}
		previous = index;
	}
	ranges.push([start, previous + 1]);
	return ranges;
}

/** Character ranges of `haystack` to emphasize, in original-string indices. */
export function matchRanges(query: string, haystack: string): MatchRange[] {
	const needle = normalize(query);
	if (!needle) return [];
	const { text, map } = normalizeWithMap(haystack);

	const at = text.indexOf(needle);
	if (at !== -1) {
		return toRanges(map.slice(at, at + needle.length));
	}

	const indices: number[] = [];
	let cursor = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] !== needle[cursor]) continue;
		indices.push(map[index]);
		cursor += 1;
		if (cursor === needle.length) return toRanges(indices);
	}
	return [];
}
