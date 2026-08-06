import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeText, readTextFile, writeTextFile } from "./textFile";

const text = "Changed files: café 🚀";
const utf8Bytes = new TextEncoder().encode(`${text} edited`);

describe("text files", () => {
	let root = "";

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-text-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it.each([
		["UTF-16LE", Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")],
		[
			"UTF-16BE",
			Buffer.from([0xfe, 0xff]),
			swapBytes(Buffer.from(text, "utf16le")),
		],
	])("decodes and preserves %s files", async (_name, bom, content) => {
		const filePath = path.join(root, "note.md");
		await fs.writeFile(filePath, Buffer.concat([bom, content]));

		expect(await readTextFile(filePath)).toBe(text);
		await writeTextFile(filePath, utf8Bytes);

		const saved = await fs.readFile(filePath);
		expect(saved.subarray(0, 2)).toEqual(bom);
		expect(decodeText(saved)).toBe(`${text} edited`);
	});

	it("keeps UTF-8 files as UTF-8", async () => {
		const filePath = path.join(root, "note.txt");
		await fs.writeFile(filePath, text, "utf8");

		await writeTextFile(filePath, utf8Bytes);

		expect(await fs.readFile(filePath)).toEqual(Buffer.from(utf8Bytes));
	});
});

function swapBytes(bytes: Uint8Array): Buffer {
	const swapped = Buffer.from(bytes);
	for (let index = 0; index < swapped.length; index += 2) {
		[swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
	}
	return swapped;
}
