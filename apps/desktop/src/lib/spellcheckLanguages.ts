const displayNames = new Intl.DisplayNames(undefined, { type: "language" });

export function languageName(tag: string): string {
	try {
		return displayNames.of(tag) ?? tag;
	} catch {
		return tag;
	}
}

function baseLanguage(tag: string): string {
	return tag.split("-")[0]?.toLowerCase() ?? tag;
}

export function isDefaultLanguage(tags: string[], systemLanguage: string) {
	return (
		tags.length === 1 &&
		baseLanguage(tags[0] ?? "") === baseLanguage(systemLanguage)
	);
}

export function sortLanguages(tags: string[]): string[] {
	return [...tags].sort((a, b) =>
		languageName(a).localeCompare(languageName(b)),
	);
}
