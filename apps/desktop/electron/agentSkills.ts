import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Written into every SKILL.md Hubble installs. Hubble only rewrites or removes
// skill folders whose SKILL.md carries it, or that match a published version
// exactly, so edited copies and other skills with the same name are never
// touched.
export const INSTALLED_MARKER = "installed-by:hubble";
const markerComment = `<!-- ${INSTALLED_MARKER}. Hubble updates this skill when Hubble updates, replacing local edits. -->`;

// Repos the skills CLI may have installed Hubble skills from, as recorded in
// the `source` field of its lock file.
const SKILLS_CLI_SOURCES = ["bholmesdev/hubble-skills", "bholmesdev/hubble.md"];

export type AgentSkillsInstallResult = {
	installed: string[];
	/** Skill folders already present that Hubble did not install. */
	skipped: string[];
};

export type AgentSkillsOptions = {
	/** The skills shipped with the app, or the repo's .agents/skills in dev. */
	bundleDir: string;
	/** Agent skill folders to install into, such as ~/.claude/skills. */
	targetDirs: string[];
	/** Records the Hubble version that last wrote the installed skills. */
	manifestPath: string;
	appVersion: string;
	/**
	 * SKILL.md hashes of every version of each skill ever published, so copies
	 * installed by the skills CLI can be recognized as unedited and updated.
	 */
	publishedHashes: Record<string, string[]>;
	/** The skills CLI's global lock file, ~/.agents/.skill-lock.json. */
	skillsCliLockPath: string;
};

type SkillFolderState = "missing" | "owned" | "published" | "foreign";

/**
 * Installs the user-facing skills bundled with Hubble into agent skill folders
 * and keeps them in step with the app version. Dev skills in the same bundle
 * are marked `metadata.internal: true` and never installed.
 */
export class AgentSkills {
	// A plain field rather than a constructor parameter property, so
	// scripts/update-skill-hashes.mjs can import this file with Node's type
	// stripping.
	private readonly options: AgentSkillsOptions;

	constructor(options: AgentSkillsOptions) {
		this.options = options;
	}

	bundledSkillNames(): Promise<string[]> {
		return userSkillNames(this.options.bundleDir);
	}

	/** Installs every bundled skill. Runs only from an explicit user action. */
	async install(): Promise<AgentSkillsInstallResult> {
		const result = await this.writeSkills(await this.targetDirs());
		await this.writeManifest();
		return result;
	}

	/**
	 * Runs on launch. Takes over unedited copies installed by the skills CLI,
	 * and when the app version changed since the last write, rewrites the skills
	 * Hubble owns and removes owned skills this version no longer ships. It only
	 * updates skills already on disk: adding one, including one newly bundled,
	 * waits for the user to click Install.
	 */
	async sync(): Promise<void> {
		const versionChanged =
			(await this.readManifestVersion()) !== this.options.appVersion;
		const bundled = await this.bundledSkillNames();

		const dirsToWrite: string[] = [];
		for (const dir of await this.targetDirs()) {
			const states = await this.skillStates(dir);
			const owned = [...states].filter(([, state]) => state === "owned");
			const hasPublished = [...states.values()].includes("published");
			if (!hasPublished && (!versionChanged || owned.length === 0)) continue;

			for (const [name] of owned) {
				if (!bundled.includes(name)) {
					await fs.rm(path.join(dir, name), { recursive: true, force: true });
				}
			}
			dirsToWrite.push(dir);
		}
		if (dirsToWrite.length === 0) return;

		await this.writeSkills(dirsToWrite, { existingOnly: true });
		await this.writeManifest();
	}

	/**
	 * Target folders with symlinked duplicates dropped. Some users link
	 * ~/.claude/skills to ~/.agents/skills, which would install everything
	 * twice into the same folder.
	 */
	private async targetDirs(): Promise<string[]> {
		const seen = new Set<string>();
		const dirs: string[] = [];
		for (const dir of this.options.targetDirs) {
			const real = await fs.realpath(dir).catch(() => dir);
			if (seen.has(real)) continue;
			seen.add(real);
			dirs.push(dir);
		}
		return dirs;
	}

	private async writeSkills(
		targetDirs: string[],
		{ existingOnly = false } = {},
	): Promise<AgentSkillsInstallResult> {
		const names = await this.bundledSkillNames();
		const result: AgentSkillsInstallResult = { installed: [], skipped: [] };
		const takenOver = new Set<string>();
		for (const dir of targetDirs) {
			await fs.mkdir(dir, { recursive: true });
			for (const name of names) {
				const target = path.join(dir, name);
				const state = await this.skillFolderState(target, name);
				if (state === "foreign") {
					result.skipped.push(target);
					continue;
				}
				if (state === "missing" && existingOnly) continue;
				if (state === "published") takenOver.add(name);
				// The skills CLI may have linked this folder to its copy in
				// ~/.agents/skills. Removing only unlinks it, and the copy below
				// replaces it with a real folder.
				if (state !== "missing") await fs.rm(target, { recursive: true });
				await fs.cp(path.join(this.options.bundleDir, name), target, {
					recursive: true,
				});
				const skillMdPath = path.join(target, "SKILL.md");
				const skillMd = await fs.readFile(skillMdPath, "utf8");
				await fs.writeFile(skillMdPath, withMarker(skillMd));
				result.installed.push(target);
			}
		}
		if (takenOver.size > 0) await this.forgetSkillsCliInstalls(takenOver);
		return result;
	}

	private async skillStates(
		dir: string,
	): Promise<Map<string, SkillFolderState>> {
		let entries: string[];
		try {
			entries = await fs.readdir(dir);
		} catch {
			return new Map();
		}
		const states = await Promise.all(
			entries.map((name) => this.skillFolderState(path.join(dir, name), name)),
		);
		return new Map(entries.map((name, index) => [name, states[index]]));
	}

	private async skillFolderState(
		folder: string,
		name: string,
	): Promise<SkillFolderState> {
		try {
			await fs.lstat(folder);
		} catch {
			return "missing";
		}
		const skillMd = await readText(path.join(folder, "SKILL.md"));
		if (skillMd === null) return "foreign";
		if (skillMd.includes(INSTALLED_MARKER)) return "owned";
		return this.options.publishedHashes[name]?.includes(skillHash(skillMd))
			? "published"
			: "foreign";
	}

	/**
	 * Drops lock entries for skills Hubble took over, so `npx skills update`
	 * stops pulling them from the archived hubble-skills repo and overwriting
	 * Hubble's copies.
	 */
	private async forgetSkillsCliInstalls(names: Set<string>): Promise<void> {
		const text = await readText(this.options.skillsCliLockPath);
		if (text === null) return;
		let lock: { skills?: Record<string, { source?: unknown }> };
		try {
			lock = JSON.parse(text);
		} catch {
			return;
		}
		let changed = false;
		for (const name of names) {
			const source = lock.skills?.[name]?.source;
			if (typeof source === "string" && SKILLS_CLI_SOURCES.includes(source)) {
				delete lock.skills?.[name];
				changed = true;
			}
		}
		if (changed) {
			await fs.writeFile(
				this.options.skillsCliLockPath,
				JSON.stringify(lock, null, 2),
			);
		}
	}

	private async readManifestVersion(): Promise<string | null> {
		const text = await readText(this.options.manifestPath);
		try {
			const { appVersion } = JSON.parse(text ?? "null") ?? {};
			return typeof appVersion === "string" ? appVersion : null;
		} catch {
			// A corrupt manifest is treated as missing, which triggers a sync.
			return null;
		}
	}

	private async writeManifest(): Promise<void> {
		await fs.mkdir(path.dirname(this.options.manifestPath), {
			recursive: true,
		});
		await fs.writeFile(
			this.options.manifestPath,
			`${JSON.stringify({ appVersion: this.options.appVersion }, null, 2)}\n`,
		);
	}
}

/** Names of the skill folders in `skillsDir` that aren't marked internal. */
export async function userSkillNames(skillsDir: string): Promise<string[]> {
	const entries = await fs.readdir(skillsDir, { withFileTypes: true });
	const names = await Promise.all(
		entries.map(async (entry) => {
			if (!entry.isDirectory()) return null;
			const skillMd = await readText(
				path.join(skillsDir, entry.name, "SKILL.md"),
			);
			if (skillMd === null || isInternalSkill(skillMd)) return null;
			return entry.name;
		}),
	);
	return names.filter((name) => name !== null).sort();
}

function isInternalSkill(skillMd: string): boolean {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)?.[1] ?? "";
	return /^metadata:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+internal:[ \t]*true\b/m.test(
		`${frontmatter}\n`,
	);
}

/** Hashes a SKILL.md the same way across platforms' line endings. */
export function skillHash(skillMd: string): string {
	return createHash("sha256")
		.update(skillMd.replace(/\r\n/g, "\n"))
		.digest("hex");
}

/** Puts the marker right after the frontmatter, where agents skip past it. */
function withMarker(skillMd: string): string {
	const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(skillMd)?.[0];
	if (!frontmatter) return `${markerComment}\n\n${skillMd}`;
	return `${frontmatter}${markerComment}\n${skillMd.slice(frontmatter.length)}`;
}

async function readText(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch {
		return null;
	}
}
