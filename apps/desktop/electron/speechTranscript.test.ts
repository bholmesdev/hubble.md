import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createTranscript, type SpeechSegment } from "./speechTranscript";

it("keeps settled phrases when the next utterance restarts its timestamps", () => {
	const transcript = createTranscript();
	expect(transcript.update([{ start: 0, end: 0, text: "Read this" }])).toBe(
		"Read this",
	);
	expect(
		transcript.update(
			[{ start: 0.4, end: 1.2, text: "Read this section." }],
			true,
		),
	).toBe("Read this section.");
	expect(transcript.update([{ start: 0, end: 0, text: "Add" }])).toBe(
		"Read this section. Add",
	);
	expect(
		transcript.update([{ start: 0, end: 0, text: "Add supporting citations" }]),
	).toBe("Read this section. Add supporting citations");
	expect(
		transcript.update(
			[{ start: 4.1, end: 5.7, text: "Add supporting citations." }],
			true,
		),
	).toBe("Read this section. Add supporting citations.");
	expect(transcript.update([])).toBe(
		"Read this section. Add supporting citations.",
	);
});

it("replaces a whole partial snapshot even when its word timings change", () => {
	const transcript = createTranscript();
	transcript.update([
		{ start: 0, end: 0, text: "Read " },
		{ start: 0, end: 0, text: "that" },
	]);
	expect(
		transcript.update(
			[
				{ start: 0.8, end: 1.1, text: "Read " },
				{ start: 1.3, end: 2, text: "this section." },
			],
			true,
		),
	).toBe("Read this section.");
	expect(
		transcript.update(
			[
				{ start: 0.8, end: 1.1, text: "Read " },
				{ start: 1.3, end: 2, text: "this section!" },
			],
			true,
		),
	).toBe("Read this section!");
});

it("preserves intentional repetitions across pauses without duplicating final callbacks", () => {
	const transcript = createTranscript();
	const phrase = [{ start: 0, end: 0, text: "Very good." }];
	transcript.update(phrase, true);
	transcript.update([]);
	expect(transcript.update(phrase)).toBe("Very good. Very good.");
	expect(transcript.update(phrase, true)).toBe("Very good. Very good.");
	expect(transcript.update(phrase, true)).toBe("Very good. Very good.");
});

it("keeps the last partial when an empty callback settles the utterance", () => {
	const transcript = createTranscript();
	transcript.update([{ start: 0, end: 0, text: "Keep these words." }]);
	transcript.update([], true);
	expect(transcript.update([{ start: 0, end: 0, text: "And these." }])).toBe(
		"Keep these words. And these.",
	);
});

// Captured from generated speech with two six-second pauses through the native recognizer.
it("retains all three utterances throughout a real macOS callback trace", () => {
	const trace = JSON.parse(
		readFileSync(
			new URL("./fixtures/dictation-utterances.json", import.meta.url),
			"utf8",
		),
	) as { text: string; segments: SpeechSegment[]; settled: boolean }[];
	const transcript = createTranscript();
	const snapshots = trace.map((event) =>
		transcript.update(event.segments, event.settled),
	);
	expect(
		snapshots.every((text) => text.startsWith("Read this section carefully")),
	).toBe(true);
	expect(snapshots[snapshots.length - 1]).toBe(
		[trace[1].text, trace[3].text, trace[5].text].join(" "),
	);
});

it("replaces volatile analyzer ranges without losing completed text or duplicating punctuation", async () => {
	const { createRangeTranscript } = await import("./speechTranscript");
	const transcript = createRangeTranscript();
	expect(transcript.update({ start: 0, end: 1 }, "Hello")).toBe("Hello");
	expect(transcript.update({ start: 0, end: 2 }, "Hello, world.")).toBe(
		"Hello, world.",
	);
	expect(transcript.update({ start: 2, end: 4 }, " How are you")).toBe(
		"Hello, world. How are you",
	);
	expect(transcript.update({ start: 2, end: 4 }, " How are you?")).toBe(
		"Hello, world. How are you?",
	);
	expect(transcript.update({ start: 0, end: 2 }, "Hello, world!")).toBe(
		"Hello, world! How are you?",
	);
});

it("replays native SpeechAnalyzer revisions with punctuation and keeps earlier passages after pauses", async () => {
	const { createRangeTranscript } = await import("./speechTranscript");
	const trace = JSON.parse(
		readFileSync(
			new URL("./fixtures/speech-analyzer.json", import.meta.url),
			"utf8",
		),
	) as { text: string; range: { start: number; end: number } }[];
	const transcript = createRangeTranscript();
	const snapshots = trace.map((event) =>
		transcript.update(event.range, event.text),
	);
	expect(snapshots[snapshots.length - 1]).toBe(
		"Read this section carefully and keep all of these words in the message. This is the 1st part of a longer recording. Add supporting citations to the highlighted passage. Keep the 1st part and add the 2nd part after it. Finish with the short summary. All three parts should remain in the message.",
	);
	expect(
		snapshots
			.filter((text) => text.includes("supporting citations"))
			.every((text) => text.startsWith("Read this section carefully")),
	).toBe(true);
});
