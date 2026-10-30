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

	it("labels HTML apps and diagrams and reports unreadable notes as failed", async () => {
		const app = path.join(root, "app.html");
		await fs.writeFile(app, "<h1>App</h1>");
		const diagram = path.join(root, "flow.tldr");
		await fs.writeFile(diagram, "{}");
		const missing = path.join(root, "missing.md");

		expect(await readNotePreviews([app, diagram, missing], resolve)).toEqual({
			[app]: { title: null, description: "HTML App" },
			[diagram]: { title: null, description: "Diagram" },
			[missing]: null,
		});
	});

	it("can retry a failed file and distinguishes empty notes from failures", async () => {
		const note = path.join(root, "recover.md");
		expect((await readNotePreviews([note], resolve))[note]).toBeNull();
		await fs.writeFile(note, "");
		expect((await readNotePreviews([note], resolve))[note]).toEqual({
			title: null,
			description: null,
		});
		await fs.writeFile(note, "# Recovered\n\nBody");
		expect((await readNotePreviews([note], resolve))[note]).toEqual({
			title: "Recovered",
			description: "Body",
		});
	});

	it("reports paths the resolver rejects as failed", async () => {
		const note = path.join(root, "note.md");
		await fs.writeFile(note, "# Secret\n");
		const deny = () => {
			throw new Error("not granted");
		};

		expect(await readNotePreviews([note], deny)).toEqual({
			[note]: null,
		});
	});
});
