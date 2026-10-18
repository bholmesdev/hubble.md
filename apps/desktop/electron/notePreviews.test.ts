import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readNotePreviews } from "./notePreviews";

describe("readNotePreviews", () => {
	let root = "";
	const resolve = (filePath: string) => filePath;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-previews-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("reads the title and first line from the start of a large note", async () => {
		const note = path.join(root, "big.md");
		await fs.writeFile(
			note,
			`# Big note\n\nFirst line\n\n${"filler ".repeat(50_000)}`,
		);

		expect(await readNotePreviews([note], resolve)).toEqual({
			[note]: { title: "Big note", description: "First line" },
		});
	});

	it("reads further when front matter runs past the first read", async () => {
		const note = path.join(root, "long-front-matter.md");
		const longValue = "x".repeat(6 * 1024);
		await fs.writeFile(
			note,
			`---\nnotes: ${longValue}\n---\n\n# Title\n\nBody\n`,
		);

		expect((await readNotePreviews([note], resolve))[note]).toEqual({
			title: "Title",
			description: "Body",
		});
	});

	it("labels HTML apps and leaves unreadable notes empty", async () => {
		const app = path.join(root, "app.html");
		await fs.writeFile(app, "<h1>App</h1>");
		const missing = path.join(root, "missing.md");

		expect(await readNotePreviews([app, missing], resolve)).toEqual({
			[app]: { title: null, description: "HTML App" },
			[missing]: { title: null, description: null },
		});
	});

	it("leaves paths the resolver rejects empty", async () => {
		const note = path.join(root, "note.md");
		await fs.writeFile(note, "# Secret\n");
		const deny = () => {
			throw new Error("not granted");
		};

		expect(await readNotePreviews([note], deny)).toEqual({
			[note]: { title: null, description: null },
		});
	});
});
