import fs from "node:fs/promises";
import { hasHtmlExtension, hasMarkdownExtension } from "../src/lib/filePath";
import { type NotePreview, notePreview } from "../src/lib/titleGeneration";

/** Enough for front matter plus a title and first line in almost every note. */
const HEAD_BYTES = 4 * 1024;
/** Fallback when front matter runs past the first read. */
const LONG_HEAD_BYTES = 64 * 1024;
const PREVIEW_CONCURRENCY = 8;

const EMPTY: NotePreview = { title: null, description: null };

/**
 * Titles and first lines for many notes in one call, reading only the start of
 * each file. Unreadable or unauthorized paths get an empty preview.
 */
export async function readNotePreviews(
	paths: string[],
	resolve: (path: string) => string,
): Promise<Record<string, NotePreview>> {
	const previews: Record<string, NotePreview> = {};
	let cursor = 0;
	async function worker() {
		while (cursor < paths.length) {
			const path = paths[cursor];
			cursor += 1;
			try {
				previews[path] = await readPreview(resolve(path));
			} catch {
				previews[path] = EMPTY;
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(PREVIEW_CONCURRENCY, paths.length) }, worker),
	);
	return previews;
}

async function readPreview(filePath: string): Promise<NotePreview> {
	if (hasHtmlExtension(filePath))
		return { title: null, description: "HTML App" };
	if (!hasMarkdownExtension(filePath)) return EMPTY;
	let head = await readHead(filePath, HEAD_BYTES);
	if (!head.complete && frontMatterUnclosed(head.text)) {
		head = await readHead(filePath, LONG_HEAD_BYTES);
	}
	return notePreview(head.text);
}

async function readHead(filePath: string, bytes: number) {
	const handle = await fs.open(filePath, "r");
	try {
		const buffer = Buffer.alloc(bytes);
		const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
		return {
			text: buffer.toString("utf8", 0, bytesRead),
			complete: bytesRead < bytes,
		};
	} finally {
		await handle.close();
	}
}

/** Front matter that opens but doesn't close within `text` hides the body. */
function frontMatterUnclosed(text: string) {
	return /^---\r?\n/.test(text) && !/\r?\n---\s*(\r?\n|$)/.test(text.slice(3));
}
