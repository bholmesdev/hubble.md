import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror.js";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown.js";

const MARK_TYPES = ["bold", "italic", "strike"] as const;
type MarkType = (typeof MARK_TYPES)[number];

// Seeded random generator (mulberry32) so generated docs are reproducible.
// Math.random is not seedable, and a failing iteration must be replayable
// from the seed printed in the assertion message.
function createSeededRandom(seed: number) {
	return () => {
		seed += 0x6d2b79f5;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomInt(random: () => number, max: number) {
	return Math.floor(random() * max);
}

function randomWhitespace(random: () => number) {
	const length = randomInt(random, 4);
	let result = "";
	for (let i = 0; i < length; i += 1) {
		result += random() < 0.75 ? " " : "\t";
	}
	return result;
}

function randomWord(random: () => number) {
	const length = 1 + randomInt(random, 8);
	let result = "";
	for (let i = 0; i < length; i += 1) {
		result += String.fromCharCode(97 + randomInt(random, 26));
	}
	return result;
}

function randomMarks(random: () => number) {
	const depth = randomInt(random, MARK_TYPES.length + 1);
	return MARK_TYPES.slice(0, depth).map((type) => ({ type }));
}

function randomDoc(random: () => number): JSONContent {
	const segmentCount = 1 + randomInt(random, 6);
	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: Array.from({ length: segmentCount }, (_, index) => ({
					type: "text",
					text: `${index === 0 ? "" : randomWhitespace(random)}${randomWord(random)}${index === segmentCount - 1 ? "" : randomWhitespace(random)}`,
					marks: randomMarks(random),
				})),
			},
		],
	};
}

function textNodes(doc: JSONContent) {
	const nodes: JSONContent[] = [];

	function visit(node: JSONContent) {
		if (node.type === "text") {
			nodes.push(node);
		}
		for (const child of node.content ?? []) {
			visit(child);
		}
	}

	visit(doc);
	return nodes;
}

function hasMark(node: JSONContent, markType: MarkType) {
	return node.marks?.some((mark) => mark.type === markType) ?? false;
}

function markedRuns(doc: JSONContent, markType: MarkType) {
	const runs: string[] = [];
	let current = "";

	for (const node of textNodes(doc)) {
		if (hasMark(node, markType)) {
			current += node.text ?? "";
			continue;
		}
		if (current) {
			runs.push(current);
		}
		current = "";
	}

	if (current) {
		runs.push(current);
	}

	return runs;
}

function trimmedMarkedRuns(doc: JSONContent, markType: MarkType) {
	return markedRuns(doc, markType)
		.map((run) => run.trim())
		.filter(Boolean)
		.sort();
}

function expectNoMarkedBoundaryWhitespace(doc: JSONContent, message: string) {
	for (const markType of MARK_TYPES) {
		for (const run of markedRuns(doc, markType)) {
			expect(run, `${message} ${markType} run`).not.toMatch(/^[ \t]|[ \t]$/);
		}
	}
}

describe("markdown round trip", () => {
	it("keeps generated emphasis markdown stable", () => {
		const seed = 0x5eed1234;
		const random = createSeededRandom(seed);

		for (let iteration = 0; iteration < 200; iteration += 1) {
			const doc = randomDoc(random);
			const message = `seed ${seed} iteration ${iteration} doc ${JSON.stringify(doc)}`;
			const md = tiptapDocToMarkdown(doc);
			const reparsed = markdownToTiptapDoc(md);

			expect(tiptapDocToMarkdown(reparsed), message).toBe(md);
			expectNoMarkedBoundaryWhitespace(reparsed, message);
			for (const markType of MARK_TYPES) {
				expect(
					trimmedMarkedRuns(reparsed, markType),
					`${message} ${markType}`,
				).toEqual(trimmedMarkedRuns(doc, markType));
			}
		}
	});
});
