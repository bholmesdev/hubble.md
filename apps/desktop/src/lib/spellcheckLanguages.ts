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

export function matchesSystemLanguage(tags: string[], systemLanguage: string) {
	const system = baseLanguage(systemLanguage);
	return tags.some((tag) => baseLanguage(tag) === system);
}

export function sortLanguages(tags: string[]): string[] {
	return [...tags].sort((a, b) =>
		languageName(a).localeCompare(languageName(b)),
	);
}
