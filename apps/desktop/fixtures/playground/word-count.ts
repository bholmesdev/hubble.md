export function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

export function readingTime(text: string, wordsPerMinute = 200): number {
	return Math.ceil(wordCount(text) / wordsPerMinute);
}
