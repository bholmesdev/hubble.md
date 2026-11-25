export type SpeechSegment = { start: number; end: number; text: string };

export function createTranscript() {
	const phrases: string[] = [];
	let partial = "";
	let settled = false;
	return {
		update(next: SpeechSegment[], complete = false) {
			const text = next
				.map((word) => word.text)
				.join("")
				.trim();
			if (text) {
				// Timings can reset to zero between utterances and change as words settle.
				// Only the recognizer's utterance boundary makes the prior phrase permanent.
				if (settled && !complete) phrases.push(partial);
				partial = text;
				settled = complete;
			}
			if (complete && partial) settled = true;
			return [...phrases, partial].filter(Boolean).join(" ");
		},
	};
}

export function createRangeTranscript() {
	let parts: SpeechSegment[] = [];
	return {
		update(range: { start: number; end: number }, text: string) {
			// SpeechAnalyzer revisions identify the exact audio range they replace.
			parts = parts.filter(
				(part) => part.end <= range.start || part.start >= range.end,
			);
			parts.push({ ...range, text });
			parts.sort((a, b) => a.start - b.start);
			return parts
				.map((part) => part.text)
				.join("")
				.trim();
		},
	};
}
