const MAX_TITLE_LENGTH = 40;

/**
 * A capture's suggested title: the first line of the note that still says
 * something once markdown syntax and link URLs are stripped away.
 */
export function captureTitleFromMarkdown(markdown: string): string {
	for (const line of markdown.split("\n")) {
		const text = meaningfulText(line);
		if (text) return text.slice(0, MAX_TITLE_LENGTH).trimEnd();
	}
	return "";
}

function meaningfulText(line: string): string {
	if (/^(?:-{3,}|_{3,}|\*{3,})$/.test(line.trim())) return "";
	return (
		line
			.trim()
			// Leading block markers: headings, quotes, list bullets, task boxes.
			.replace(
				/^(?:#{1,6}\s+|(?:>\s*)+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/,
				"",
			)
			// Links and images read as their text, never their URL.
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
			.replace(/\[\[([^\]]*)\]\]/g, "$1")
			.replace(/https?:\/\/\S+/g, "")
			.replace(/[*_~`]/g, "")
			.replace(/<[^>]+>/g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}
