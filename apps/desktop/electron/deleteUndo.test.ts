import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeleteUndo } from "./deleteUndo";

describe("DeleteUndo", () => {
	let workspace: string;

	beforeEach(async () => {
		workspace = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-delete-undo-"));
	});

	afterEach(async () => {
		await fs.rm(workspace, { recursive: true, force: true });
	});

	it("stages and restores a file", async () => {
		const source = path.join(workspace, "note.md");
		await fs.writeFile(source, "original");
		const trash = new DeleteUndo();

		const token = await trash.stage(workspace, [source]);
		await expect(fs.stat(source)).rejects.toMatchObject({ code: "ENOENT" });

		await trash.restore(token);
		expect(await fs.readFile(source, "utf8")).toBe("original");
	});

	it("keeps the staged file when its path is recreated", async () => {
		const source = path.join(workspace, "note.md");
		await fs.writeFile(source, "original");
		const trash = new DeleteUndo();
		const token = await trash.stage(workspace, [source]);
		await fs.writeFile(source, "replacement");

		await expect(trash.restore(token)).rejects.toThrow(/Deleted files kept at/);

		expect(await fs.readFile(source, "utf8")).toBe("replacement");
		expect(
			await fs.readFile(
				path.join(workspace, ".hubble", "delete-recovery", token, "0"),
				"utf8",
			),
		).toBe("original");
	});
});
