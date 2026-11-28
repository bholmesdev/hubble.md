import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceTools } from "./chatTools";

let root: string;
let tools: WorkspaceTools;
let controller: AbortController;
let bridge: { read: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-tools-"));
	await fs.mkdir(path.join(root, "notes"));
	await fs.writeFile(
		path.join(root, "notes/a.md"),
		"# Leonardo\nHe lived in Milan.\n",
	);
	await fs.writeFile(path.join(root, "notes/b.md"), "Another note\n");
	bridge = { read: vi.fn(async () => null), write: vi.fn(async () => false) };
	controller = new AbortController();
	tools = new WorkspaceTools(root, bridge, controller.signal);
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
const patch = (old = "He lived in Milan.", next = "He painted in Milan.") =>
	`*** Begin Patch\n*** Update File: notes/a.md\n@@\n # Leonardo\n-${old}\n+${next}\n*** End Patch`;

it("lists paths separately from content matches and bounds search results", async () => {
	expect(
		await tools.run("list_files", { path: ".", glob: "**/*.md" }),
	).toMatchObject({ files: ["notes/a.md", "notes/b.md"], truncated: false });
	expect(
		await tools.run("search_content", {
			query: "Milan",
			path: ".",
			glob: "**/*.md",
		}),
	).toMatchObject({
		matches: [{ path: "notes/a.md", line: 2, text: "He lived in Milan." }],
		truncated: false,
	});
	await fs.writeFile(path.join(root, "notes/b.md"), "Milan\n".repeat(300));
	const result = await tools.run("search_content", { query: "Milan" });
	expect(result.truncated).toBe(true);
	expect((result.matches as unknown[]).length).toBeLessThanOrEqual(100);
});

it("reads line ranges with a full-file version and applies exact patches", async () => {
	const read = await tools.run("read_file", {
		path: "notes/a.md",
		start_line: 2,
		end_line: 2,
	});
	expect(read).toMatchObject({
		text: "He lived in Milan.",
		start_line: 2,
		total_lines: 3,
	});
	expect(
		await tools.run("apply_patch", {
			patch: patch(),
			expected_version: read.version,
		}),
	).toMatchObject({ path: "notes/a.md", status: "applied" });
	expect(await fs.readFile(path.join(root, "notes/a.md"), "utf8")).toBe(
		"# Leonardo\nHe painted in Milan.\n",
	);
});

it("rejects traversal, absolute paths, and symlink escapes without touching outside files", async () => {
	const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-outside-"));
	try {
		await fs.writeFile(path.join(outside, "private.md"), "Private");
		await fs.symlink(outside, path.join(root, "escape"));
		for (const file of [
			"../private.md",
			path.join(outside, "private.md"),
			"escape/private.md",
			"C:\\private.md",
		]) {
			await expect(tools.run("read_file", { path: file })).rejects.toThrow(
				/workspace|relative/i,
			);
		}
		await expect(
			tools.run("apply_patch", {
				patch: patch().replace("notes/a.md", "escape/private.md"),
				expected_version: "anything",
			}),
		).rejects.toThrow(/workspace/i);
		expect(await fs.readFile(path.join(outside, "private.md"), "utf8")).toBe(
			"Private",
		);
	} finally {
		await fs.rm(outside, { recursive: true, force: true });
	}
});

it("rejects stale versions, ambiguous patches, binary files, and cancellation", async () => {
	const read = await tools.run("read_file", { path: "notes/a.md" });
	await fs.writeFile(
		path.join(root, "notes/a.md"),
		"# Leonardo\nHe lived in Milan.\nHuman addition\n",
	);
	await expect(
		tools.run("apply_patch", {
			patch: patch(),
			expected_version: read.version,
		}),
	).rejects.toThrow(/changed|version/i);
	expect(await fs.readFile(path.join(root, "notes/a.md"), "utf8")).toBe(
		"# Leonardo\nHe lived in Milan.\nHuman addition\n",
	);
	await fs.writeFile(path.join(root, "notes/a.md"), "repeat\nrepeat\n");
	const repeated = await tools.run("read_file", { path: "notes/a.md" });
	await expect(
		tools.run("apply_patch", {
			patch: patch()
				.replace(" # Leonardo\n", "")
				.replace("He lived in Milan.", "repeat"),
			expected_version: repeated.version,
		}),
	).rejects.toThrow(/ambiguous/i);
	await fs.writeFile(path.join(root, "image.png"), "binary");
	await expect(tools.run("read_file", { path: "image.png" })).rejects.toThrow(
		/text/i,
	);
	controller.abort();
	await expect(tools.run("list_files", {})).rejects.toThrow();
});

it("reads unsaved editor text and routes its patch through the editor bridge", async () => {
	bridge.read.mockResolvedValue({
		text: "# Leonardo\nUnsaved sentence.\n",
		diskContent: "# Leonardo\nHe lived in Milan.\n",
	});
	bridge.write.mockResolvedValue(true);
	const read = await tools.run("read_file", { path: "notes/a.md" });
	expect(read.text).toContain("Unsaved sentence.");
	await tools.run("apply_patch", {
		patch: patch("Unsaved sentence.", "Improved sentence."),
		expected_version: read.version,
	});
	expect(bridge.write).toHaveBeenCalledWith(
		path.join(root, "notes/a.md"),
		"# Leonardo\nUnsaved sentence.\n",
		"# Leonardo\nImproved sentence.\n",
	);
});

it("creates a new file without overwriting existing files or following a parent symlink outside the workspace", async () => {
	const add = (file: string) =>
		`*** Begin Patch\n*** Add File: ${file}\n+# New note\n+\n+Created by the agent.\n*** End Patch`;
	expect(
		await tools.run("apply_patch", { patch: add("drafts/new.md") }),
	).toMatchObject({ path: "drafts/new.md", status: "created" });
	expect(await fs.readFile(path.join(root, "drafts/new.md"), "utf8")).toBe(
		"# New note\n\nCreated by the agent.\n",
	);
	await expect(
		tools.run("apply_patch", { patch: add("notes/a.md") }),
	).rejects.toThrow();
	expect(await fs.readFile(path.join(root, "notes/a.md"), "utf8")).toContain(
		"He lived in Milan.",
	);
	const outside = await fs.mkdtemp(
		path.join(os.tmpdir(), "hubble-tool-create-outside-"),
	);
	try {
		await fs.symlink(outside, path.join(root, "escape"));
		await expect(
			tools.run("apply_patch", { patch: add("escape/new.md") }),
		).rejects.toThrow(/workspace/i);
		await expect(fs.access(path.join(outside, "new.md"))).rejects.toThrow();
	} finally {
		await fs.rm(outside, { recursive: true, force: true });
	}
});

it("requires a current read before deletion and delegates to recoverable deletion instead of unlinking", async () => {
	const remove = "*** Begin Patch\n*** Delete File: notes/a.md\n*** End Patch";
	await expect(
		tools.run("apply_patch", { patch: remove, expected_version: "unknown" }),
	).rejects.toThrow(/read|version/i);
	const read = await tools.run("read_file", { path: "notes/a.md" });
	const recover = vi.fn(async () => {
		await fs.rename(
			path.join(root, "notes/a.md"),
			path.join(root, "recovered.md"),
		);
	});
	const withDelete = Object.assign(bridge, { delete: recover });
	tools = new WorkspaceTools(root, withDelete, controller.signal);
	const fresh = await tools.run("read_file", { path: "notes/a.md" });
	expect(
		await tools.run("apply_patch", {
			patch: remove,
			expected_version: fresh.version,
		}),
	).toMatchObject({ path: "notes/a.md", status: "deleted" });
	expect(recover).toHaveBeenCalledWith(
		path.join(root, "notes/a.md"),
		read.text,
	);
	expect(await fs.readFile(path.join(root, "recovered.md"), "utf8")).toContain(
		"He lived in Milan.",
	);
});
