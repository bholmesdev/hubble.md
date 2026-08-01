import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HUBBLE_DIR } from "../src/lib/filePath";

type Entry = { source: string; staged: string };
type Job = {
	dir: string;
	entries: Entry[];
	state: "staging" | "ready" | "restoring" | "dropping";
};

function exists(filePath: string) {
	return fs.stat(filePath).then(
		() => true,
		() => false,
	);
}

function isInside(root: string, candidate: string) {
	const relative = path.relative(root, candidate);
	return (
		relative !== "" &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

/** Short-lived file trash backed by atomic moves within the workspace. */
export class DeleteUndo {
	private jobs = new Map<string, Job>();

	async stage(workspace: string, paths: string[]) {
		if (paths.length === 0) throw new Error("No files selected for deletion");
		if (new Set(paths).size !== paths.length) {
			throw new Error("Duplicate delete path");
		}
		for (const [index, source] of paths.entries()) {
			const relative = path.relative(workspace, source);
			if (
				!isInside(workspace, source) ||
				relative === HUBBLE_DIR ||
				relative.startsWith(`${HUBBLE_DIR}${path.sep}`)
			) {
				throw new Error("Delete path is outside the workspace");
			}
			if (
				paths.some(
					(candidate, candidateIndex) =>
						candidateIndex !== index && isInside(candidate, source),
				)
			) {
				throw new Error("Delete paths cannot overlap");
			}
		}

		const token = randomUUID();
		const dir = path.join(workspace, HUBBLE_DIR, "trash", token);
		const entries = paths.map((source, index) => ({
			source,
			staged: path.join(dir, String(index)),
		}));
		const job: Job = { dir, entries, state: "staging" };
		this.jobs.set(token, job);
		const moved: Entry[] = [];
		try {
			await fs.mkdir(dir, { recursive: true });
			for (const entry of entries) {
				await fs.rename(entry.source, entry.staged);
				moved.push(entry);
			}
			job.state = "ready";
			return token;
		} catch (error) {
			let failed = false;
			for (const entry of moved.reverse()) {
				try {
					await fs.rename(entry.staged, entry.source);
				} catch {
					failed = true;
				}
			}
			if (!failed) {
				await fs.rm(dir, { recursive: true, force: true });
				this.jobs.delete(token);
				throw error;
			}
			const recovery = path.join(
				workspace,
				HUBBLE_DIR,
				"delete-recovery",
				token,
			);
			await fs.mkdir(path.dirname(recovery), { recursive: true });
			await fs.rename(dir, recovery);
			this.jobs.delete(token);
			throw new Error(`Delete recovery required at ${recovery}`);
		}
	}

	async restore(token: string) {
		const job = this.jobs.get(token);
		if (!job || job.state !== "ready") {
			throw new Error("This deletion can no longer be undone");
		}
		for (const entry of job.entries) {
			if (await exists(entry.source)) {
				throw new Error(
					`Cannot restore because this path exists: ${entry.source}`,
				);
			}
		}
		job.state = "restoring";
		const moved: Entry[] = [];
		try {
			for (const entry of job.entries) {
				await fs.mkdir(path.dirname(entry.source), { recursive: true });
				await fs.rename(entry.staged, entry.source);
				moved.push(entry);
			}
		} catch (error) {
			let failed = false;
			for (const entry of moved.reverse()) {
				try {
					if (!(await exists(entry.staged))) {
						await fs.rename(entry.source, entry.staged);
					}
				} catch {
					failed = true;
				}
			}
			if (failed) {
				const workspace = path.dirname(path.dirname(path.dirname(job.dir)));
				const recovery = path.join(
					workspace,
					HUBBLE_DIR,
					"delete-recovery",
					path.basename(job.dir),
				);
				await fs.mkdir(path.dirname(recovery), { recursive: true });
				await fs.rename(job.dir, recovery);
				this.jobs.delete(token);
				throw new Error(`Delete recovery required at ${recovery}`);
			}
			job.state = "ready";
			throw error;
		}
		this.jobs.delete(token);
		await fs.rm(job.dir, { recursive: true, force: true });
		return job.entries.map((entry) => entry.source);
	}

	async drop(token: string) {
		const job = this.jobs.get(token);
		if (!job || job.state !== "ready") return;
		job.state = "dropping";
		await fs.rm(job.dir, { recursive: true, force: true });
		this.jobs.delete(token);
	}

	async clean(workspace: string) {
		const root = path.join(workspace, HUBBLE_DIR, "trash");
		const active = new Set([...this.jobs.values()].map((job) => job.dir));
		const entries = await fs
			.readdir(root, { withFileTypes: true })
			.catch((error) => {
				if (
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === "ENOENT"
				) {
					return [];
				}
				throw error;
			});
		for (const entry of entries) {
			const entryPath = path.join(root, entry.name);
			if (!active.has(entryPath)) {
				await fs.rm(entryPath, { recursive: true, force: true });
			}
		}
	}
}
