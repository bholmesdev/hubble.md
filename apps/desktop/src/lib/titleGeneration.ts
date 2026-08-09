import { parseMarkdownFrontMatter } from "@hubble.md/editor";

export const MAX_GENERATED_TITLE_LENGTH = 40;

/** Builds a file-safe stem from the first line with visible text. */
export function generatedTitleStem(markdown: string): string | null {
	const body = parseMarkdownFrontMatter(markdown).body;
	for (const line of body.split("\n")) {
		const text = meaningfulText(line);
		if (!text) continue;
		const slug = text
			.toLocaleLowerCase()
			// Join contractions instead of treating apostrophes as word breaks.
			.replace(/['’`]/g, "")
			// Keep Unicode letters and numbers; turn each other run into one dash.
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			// A file stem cannot start or end with a generated separator.
			.replace(/^-+|-+$/g, "");
		const capped = Array.from(slug)
			.slice(0, MAX_GENERATED_TITLE_LENGTH)
			.join("")
			.replace(/-+$/g, "");
		return capped || null;
	}
	return null;
}

/** Strips Markdown syntax that does not read as title text. */
function meaningfulText(line: string): string {
	const trimmed = line.trim();
	if (
		// Horizontal rules, fenced-code markers, and link definitions have no title.
		/^(?:-{3,}|_{3,}|\*{3,})$/.test(trimmed) ||
		/^```|^~~~/.test(trimmed) ||
		/^\[[^\]]+\]:\s*\S+/.test(trimmed)
	) {
		return "";
	}

	return (
		trimmed
			.replace(
				// Drop heading, quote, list, ordered-list, and task-list prefixes.
				/^(?:#{1,6}\s+|(?:>\s*)+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/,
				"",
			)
			// Links, images, and embeds contribute no visible title text here.
			.replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/!?\[[^\]]*\]\[[^\]]*\]/g, "")
			.replace(/!?\[\[[^\]]*\]\]/g, "")
			// Strip autolinks, bare URLs, and HTML tags.
			.replace(/<https?:\/\/[^>]+>/g, "")
			.replace(/https?:\/\/\S+/g, "")
			.replace(/<[^>]+>/g, "")
			// Remove inline emphasis/code markers, then fold whitespace.
			.replace(/[*_~`]/g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}
