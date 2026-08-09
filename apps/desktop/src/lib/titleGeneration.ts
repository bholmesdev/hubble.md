import { parseMarkdownFrontMatter } from "@hubble.md/editor";

export const MAX_GENERATED_TITLE_LENGTH = 40;

export function generatedTitleStem(markdown: string): string | null {
	const body = parseMarkdownFrontMatter(markdown).body;
	for (const line of body.split("\n")) {
		const text = meaningfulText(line);
		if (!text) continue;
		const slug = text
			.toLocaleLowerCase()
			.replace(/['’`]/g, "")
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "");
		const capped = Array.from(slug)
			.slice(0, MAX_GENERATED_TITLE_LENGTH)
			.join("")
			.replace(/-+$/g, "");
		return capped || null;
	}
	return null;
}

function meaningfulText(line: string): string {
	const trimmed = line.trim();
	if (
		/^(?:-{3,}|_{3,}|\*{3,})$/.test(trimmed) ||
		/^```|^~~~/.test(trimmed) ||
		/^\[[^\]]+\]:\s*\S+/.test(trimmed)
	) {
		return "";
	}

	return trimmed
		.replace(
			/^(?:#{1,6}\s+|(?:>\s*)+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/,
			"",
		)
		.replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/!?\[[^\]]*\]\[[^\]]*\]/g, "")
		.replace(/!?\[\[[^\]]*\]\]/g, "")
		.replace(/<https?:\/\/[^>]+>/g, "")
		.replace(/https?:\/\/\S+/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/[*_~`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}
