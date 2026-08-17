import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	materializeTemplateBundle,
	rollbackMaterializedAssets,
} from "./materializeTemplate";

const roots: string[] = [];

async function makeRoot() {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "hubble-template-test-"),
	);
	roots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true })),
	);
});

describe("materializeTemplateBundle", () => {
	it("creates Markdown and a recursively copied Asset bundle", async () => {
		const root = await makeRoot();
		const source = path.join(root, "templates", "journal.md");
		const target = path.join(root, "notes", "new-file.md");
		await fs.mkdir(path.join(root, "templates", "journal.assets", "nested"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(root, "templates", "journal.assets", "nested", "image.png"),
			"image",
		);

		await materializeTemplateBundle({
			sourcePath: source,
			targetPath: target,
			content: "![Image](journal.assets/nested/image.png)",
			mode: "create",
		});

		expect(await fs.readFile(target, "utf8")).toBe(
			"![Image](new-file.assets/nested/image.png)",
		);
		expect(
			await fs.readFile(
				path.join(root, "notes", "new-file.assets", "nested", "image.png"),
				"utf8",
			),
		).toBe("image");
	});

	it("deduplicates equal files and renames byte collisions", async () => {
		const root = await makeRoot();
		const source = path.join(root, "templates", "journal.md");
		const target = path.join(root, "notes", "existing.md");
		const sourceAssets = path.join(root, "templates", "journal.assets");
		const targetAssets = path.join(root, "notes", "existing.assets");
		await fs.mkdir(sourceAssets, { recursive: true });
		await fs.mkdir(targetAssets, { recursive: true });
		await fs.writeFile(path.join(sourceAssets, "same.png"), "same");
		await fs.writeFile(path.join(sourceAssets, "chart.png"), "new");
		await fs.writeFile(path.join(targetAssets, "same.png"), "same");
		await fs.writeFile(path.join(targetAssets, "chart.png"), "old");

		const result = await materializeTemplateBundle({
			sourcePath: source,
			targetPath: target,
			content:
				"![Same](journal.assets/same.png)\n![Chart](journal.assets/chart.png)",
			mode: "existing",
		});

		expect(result.content).toBe(
			"![Same](existing.assets/same.png)\n![Chart](existing.assets/chart-2.png)",
		);
		expect(result.createdPaths).toEqual([
			path.join(targetAssets, "chart-2.png"),
		]);
		expect(
			await fs.readFile(path.join(targetAssets, "chart.png"), "utf8"),
		).toBe("old");
	});

	it("rolls back only files created by an existing-note request", async () => {
		const root = await makeRoot();
		const targetAssets = path.join(root, "notes", "existing.assets");
		await fs.mkdir(targetAssets, { recursive: true });
		const existing = path.join(targetAssets, "keep.png");
		const created = path.join(targetAssets, "remove.png");
		await fs.writeFile(existing, "keep");
		await fs.writeFile(created, "remove");

		await rollbackMaterializedAssets([created]);

		expect(await fs.readFile(existing, "utf8")).toBe("keep");
		await expect(fs.readFile(created)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("leaves no Assets when create publication fails", async () => {
		const root = await makeRoot();
		const source = path.join(root, "templates", "journal.md");
		const target = path.join(root, "notes", "new-file.md");
		await fs.mkdir(path.join(root, "templates", "journal.assets"), {
			recursive: true,
		});
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(
			path.join(root, "templates", "journal.assets", "a.png"),
			"a",
		);
		await fs.writeFile(target, "occupied");

		await expect(
			materializeTemplateBundle({
				sourcePath: source,
				targetPath: target,
				content: "![A](journal.assets/a.png)",
				mode: "create",
			}),
		).rejects.toMatchObject({ code: "EEXIST" });
		await expect(
			fs.stat(path.join(root, "notes", "new-file.assets")),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(await fs.readFile(target, "utf8")).toBe("occupied");
	});
});
