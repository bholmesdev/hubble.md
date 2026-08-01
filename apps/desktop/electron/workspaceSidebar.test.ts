import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSidebarFiles, reconcileSidebarPath } from "./workspaceSidebar";

describe("workspace sidebar reconciliation", () => {
	let root = "";

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-sidebar-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("adds a visible file without crawling unrelated files", async () => {
		await fs.writeFile(path.join(root, "existing.md"), "existing");
		const changedPath = path.join(root, "new.md");
		await fs.writeFile(changedPath, "new");

		expect(await reconcileSidebarPath(root, changedPath)).toMatchObject({
			kind: "file",
			entry: { path: path.join(root, "new.md") },
		});
	});

	it("scans only an added subtree and removes a deleted prefix", async () => {
		await fs.writeFile(path.join(root, "outside.md"), "outside");
		const subtree = path.join(root, "nested");
		await fs.mkdir(path.join(subtree, "deeper"), { recursive: true });
		await fs.writeFile(path.join(subtree, "inside.md"), "inside");
		await fs.writeFile(path.join(subtree, "deeper", "leaf.md"), "leaf");

		const added = await reconcileSidebarPath(root, subtree);
		expect(added).toMatchObject({
			kind: "subtree",
			path: subtree,
			listing: {
				files: expect.arrayContaining([
					expect.objectContaining({ path: path.join(subtree, "inside.md") }),
					expect.objectContaining({
						path: path.join(subtree, "deeper", "leaf.md"),
					}),
				]),
			},
		});

		await fs.rm(subtree, { recursive: true });
		expect(await reconcileSidebarPath(root, subtree)).toEqual({
			kind: "remove",
			path: subtree,
		});
	});

	it("reconciles ignore-file visibility for its directory only", async () => {
		const nested = path.join(root, "nested");
		await fs.mkdir(nested);
		await fs.writeFile(path.join(nested, "visible.md"), "visible");
		const ignored = path.join(nested, "ignored.md");
		await fs.writeFile(ignored, "ignored");
		const ignorePath = path.join(nested, ".ignore");
		await fs.writeFile(ignorePath, "ignored.md\n");

		const hidden = await reconcileSidebarPath(root, ignorePath);
		expect(hidden).toMatchObject({
			kind: "subtree",
			path: nested,
		});
		if (hidden.kind !== "subtree") throw new Error("expected subtree delta");
		expect(hidden.listing.files.map((file) => file.path)).toEqual([
			path.join(nested, "visible.md"),
		]);

		await fs.rm(ignorePath);
		const visible = await reconcileSidebarPath(root, ignorePath);
		expect(visible).toMatchObject({ kind: "subtree", path: nested });
		if (visible.kind !== "subtree") throw new Error("expected subtree delta");
		expect(new Set(visible.listing.files.map((file) => file.path))).toEqual(
			new Set([path.join(nested, "visible.md"), ignored]),
		);
	});

	it("preserves hidden and ignored paths out of the initial snapshot", async () => {
		await fs.mkdir(path.join(root, ".hubble"));
		await fs.mkdir(path.join(root, "docs.assets"));
		await fs.mkdir(path.join(root, "node_modules"));
		await fs.writeFile(path.join(root, ".hidden.md"), "hidden");
		await fs.writeFile(path.join(root, "visible.md"), "visible");
		await fs.writeFile(path.join(root, ".gitignore"), "ignored.md\n");
		await fs.writeFile(path.join(root, "ignored.md"), "ignored");

		const listing = await listSidebarFiles(root);
		expect(listing.files.map((file) => file.path)).toEqual([
			path.join(root, "visible.md"),
		]);
		expect(listing.folders).toEqual([]);
	});

	it("does not follow a symlink into another tree", async () => {
		const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-outside-"));
		try {
			await fs.writeFile(path.join(outside, "secret.md"), "secret");
			const link = path.join(root, "linked");
			await fs.symlink(outside, link, "dir");
			expect((await listSidebarFiles(root)).folders).toEqual([]);
			expect(await reconcileSidebarPath(root, link)).toEqual({
				kind: "remove",
				path: link,
			});
			expect(
				await reconcileSidebarPath(root, path.join(link, "secret.md")),
			).toEqual({
				kind: "remove",
				path: path.join(link, "secret.md"),
			});
		} finally {
			await fs.rm(outside, { recursive: true, force: true });
		}
	});
});
