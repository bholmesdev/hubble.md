import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalIdleReporter, resolveGitDir } from "./workspaceHints";

const OUTPUT = "\u001b[2K\rClaude is working\u001b[1A";
const KEYSTROKE = "o\becho hello[33D[1C";

describe("createTerminalIdleReporter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reports interactive output after Enter and each later quiet period", () => {
		const onIdle = vi.fn();
		const reporter = createTerminalIdleReporter(onIdle);

		reporter.recordInput("term-1", "\r");
		reporter.recordOutput("term-1", OUTPUT);
		vi.advanceTimersByTime(700);
		expect(onIdle).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(onIdle).toHaveBeenCalledTimes(1);

		reporter.recordOutput("term-1", OUTPUT);
		vi.advanceTimersByTime(750);
		expect(onIdle).toHaveBeenCalledTimes(2);
	});

	it("ignores a typed command that was never run", () => {
		const onIdle = vi.fn();
		const reporter = createTerminalIdleReporter(onIdle);

		for (let key = 0; key < 10; key += 1) {
			reporter.recordInput("term-1", "o");
			reporter.recordOutput("term-1", KEYSTROKE);
		}
		vi.advanceTimersByTime(30_000);
		expect(onIdle).not.toHaveBeenCalled();
	});

	it("waits for sustained output to settle", () => {
		const onIdle = vi.fn();
		const reporter = createTerminalIdleReporter(onIdle);

		reporter.recordInput("term-1", "\r");
		for (let tick = 0; tick < 40; tick += 1) {
			reporter.recordOutput("term-1", OUTPUT);
			vi.advanceTimersByTime(500);
		}
		expect(onIdle).not.toHaveBeenCalled();
		vi.advanceTimersByTime(750);
		expect(onIdle).toHaveBeenCalledOnce();
	});
});

describe("resolveGitDir", () => {
	let root = "";

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-git-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("returns null for a folder that is not a repo", async () => {
		expect(await resolveGitDir(root)).toBe(null);
	});

	it("finds the git dir of a normal repo", async () => {
		const gitDir = path.join(root, ".git");
		await fs.mkdir(gitDir);
		expect(await resolveGitDir(root)).toBe(gitDir);
	});

	it("follows the pointer a linked worktree leaves behind", async () => {
		const real = path.join(root, "main", ".git", "worktrees", "feature");
		await fs.mkdir(real, { recursive: true });
		const worktree = path.join(root, "feature");
		await fs.mkdir(worktree);
		await fs.writeFile(path.join(worktree, ".git"), `gitdir: ${real}\n`);
		expect(await resolveGitDir(worktree)).toBe(real);
	});

	it("resolves a relative pointer against the workspace", async () => {
		const real = path.join(root, "elsewhere");
		await fs.mkdir(real);
		const worktree = path.join(root, "feature");
		await fs.mkdir(worktree);
		await fs.writeFile(path.join(worktree, ".git"), "gitdir: ../elsewhere\n");
		expect(await resolveGitDir(worktree)).toBe(real);
	});

	it("returns null when the pointer is unreadable", async () => {
		const worktree = path.join(root, "feature");
		await fs.mkdir(worktree);
		await fs.writeFile(path.join(worktree, ".git"), "not a pointer\n");
		expect(await resolveGitDir(worktree)).toBe(null);
	});
});
