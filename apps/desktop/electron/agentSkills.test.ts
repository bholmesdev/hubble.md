import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	AgentSkills,
	type AgentSkillsOptions,
	INSTALLED_MARKER,
	skillHash,
	userSkillNames,
} from "./agentSkills";
import publishedSkillHashes from "./publishedSkillHashes.json";

const repoSkillsDir = fileURLToPath(
	new URL("../../../.agents/skills", import.meta.url),
);

const dirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true })),
	);
});

const userSkillMd = "---\nname: draw\ndescription: Draws.\n---\n# Draw\n";
const internalSkillMd =
	"---\nname: release\ndescription: Releases.\nmetadata:\n  internal: true\n---\n";

async function setup(overrides: Partial<AgentSkillsOptions> = {}) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-skills-"));
	dirs.push(dir);
	const bundleDir = path.join(dir, "bundle");
	await write(path.join(bundleDir, "draw", "SKILL.md"), userSkillMd);
	await write(path.join(bundleDir, "draw", "scripts", "draw.mjs"), "v1");
	await write(path.join(bundleDir, "release", "SKILL.md"), internalSkillMd);
	await write(path.join(bundleDir, "AGENTS.md"), "notes");
	const claudeDir = path.join(dir, ".claude", "skills");
	const agentsDir = path.join(dir, ".agents", "skills");
	const options: AgentSkillsOptions = {
		bundleDir,
		targetDirs: [agentsDir, claudeDir],
		manifestPath: path.join(dir, "userData", "agent-skills.json"),
		appVersion: "1.0.0",
		publishedHashes: {},
		skillsCliLockPath: path.join(dir, ".agents", ".skill-lock.json"),
		...overrides,
	};
	return { dir, bundleDir, claudeDir, agentsDir, options };
}

async function write(filePath: string, content: string) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content);
}

async function exists(filePath: string) {
	try {
		await fs.lstat(filePath);
		return true;
	} catch {
		return false;
	}
}

describe("AgentSkills", () => {
	it("installs only user-facing skills, with the marker and manifest", async () => {
		const { claudeDir, agentsDir, options } = await setup();
		const result = await new AgentSkills(options).install();

		expect(result.installed).toEqual([
			path.join(agentsDir, "draw"),
			path.join(claudeDir, "draw"),
		]);
		const skillMd = await fs.readFile(
			path.join(claudeDir, "draw", "SKILL.md"),
			"utf8",
		);
		expect(skillMd).toMatch(/^---\nname: draw\n[\s\S]*---\n<!-- installed-by/);
		expect(
			await fs.readFile(
				path.join(claudeDir, "draw", "scripts", "draw.mjs"),
				"utf8",
			),
		).toBe("v1");
		expect(await exists(path.join(claudeDir, "release"))).toBe(false);
		expect(JSON.parse(await fs.readFile(options.manifestPath, "utf8"))).toEqual(
			{ appVersion: "1.0.0" },
		);
	});

	it("installs once when one target folder links to another", async () => {
		const { claudeDir, agentsDir, options } = await setup();
		await fs.mkdir(agentsDir, { recursive: true });
		await fs.mkdir(path.dirname(claudeDir), { recursive: true });
		await fs.symlink(agentsDir, claudeDir);
		const result = await new AgentSkills(options).install();

		expect(result.installed).toEqual([path.join(agentsDir, "draw")]);
	});

	it("never overwrites a same-named skill Hubble did not install", async () => {
		const { claudeDir, options } = await setup();
		await write(path.join(claudeDir, "draw", "SKILL.md"), "someone else's");
		const result = await new AgentSkills(options).install();

		expect(result.skipped).toEqual([path.join(claudeDir, "draw")]);
		expect(
			await fs.readFile(path.join(claudeDir, "draw", "SKILL.md"), "utf8"),
		).toBe("someone else's");
	});

	it("rewrites owned skills and removes dropped ones after a version bump, without adding new ones", async () => {
		const { bundleDir, claudeDir, options } = await setup();
		await write(path.join(bundleDir, "old", "SKILL.md"), userSkillMd);
		await new AgentSkills(options).install();

		await fs.rm(path.join(bundleDir, "old"), { recursive: true });
		await write(path.join(bundleDir, "draw", "scripts", "draw.mjs"), "v2");
		await write(path.join(bundleDir, "added", "SKILL.md"), userSkillMd);
		await new AgentSkills({ ...options, appVersion: "1.1.0" }).sync();

		expect(
			await fs.readFile(
				path.join(claudeDir, "draw", "scripts", "draw.mjs"),
				"utf8",
			),
		).toBe("v2");
		expect(await exists(path.join(claudeDir, "old"))).toBe(false);
		expect(await exists(path.join(claudeDir, "added"))).toBe(false);
	});

	it("does nothing on launch when the version is unchanged", async () => {
		const { bundleDir, claudeDir, options } = await setup();
		await new AgentSkills(options).install();
		await write(path.join(bundleDir, "draw", "scripts", "draw.mjs"), "v2");
		await new AgentSkills(options).sync();

		expect(
			await fs.readFile(
				path.join(claudeDir, "draw", "scripts", "draw.mjs"),
				"utf8",
			),
		).toBe("v1");
	});

	it("never installs on launch into folders without Hubble skills", async () => {
		const { claudeDir, agentsDir, options } = await setup();
		await write(path.join(claudeDir, "other", "SKILL.md"), "other");
		await new AgentSkills(options).sync();

		expect(await exists(path.join(claudeDir, "draw"))).toBe(false);
		expect(await exists(agentsDir)).toBe(false);
	});

	it("takes over unedited skills CLI copies on launch", async () => {
		const { claudeDir, agentsDir, options } = await setup();
		const published = "---\nname: draw\n---\nold version\n";
		await write(path.join(agentsDir, "draw", "SKILL.md"), published);
		await fs.mkdir(claudeDir, { recursive: true });
		await fs.symlink(
			path.join(agentsDir, "draw"),
			path.join(claudeDir, "draw"),
		);
		await write(
			options.skillsCliLockPath,
			JSON.stringify({
				version: 3,
				skills: {
					draw: { source: "bholmesdev/hubble-skills" },
					other: { source: "someone/else" },
				},
			}),
		);
		await new AgentSkills({
			...options,
			publishedHashes: { draw: [skillHash(published)] },
		}).sync();

		for (const dir of [agentsDir, claudeDir]) {
			expect((await fs.lstat(path.join(dir, "draw"))).isDirectory()).toBe(true);
			expect(
				await fs.readFile(path.join(dir, "draw", "SKILL.md"), "utf8"),
			).toContain(INSTALLED_MARKER);
		}
		expect(
			JSON.parse(await fs.readFile(options.skillsCliLockPath, "utf8")).skills,
		).toEqual({ other: { source: "someone/else" } });
	});

	it("leaves edited skills CLI copies alone", async () => {
		const { agentsDir, options } = await setup();
		const published = "---\nname: draw\n---\nold version\n";
		await write(
			path.join(agentsDir, "draw", "SKILL.md"),
			`${published}my edit\n`,
		);
		await new AgentSkills({
			...options,
			publishedHashes: { draw: [skillHash(published)] },
		}).sync();

		expect(
			await fs.readFile(path.join(agentsDir, "draw", "SKILL.md"), "utf8"),
		).toBe(`${published}my edit\n`);
	});
});

describe("repo skills", () => {
	it("records the hash of every bundled skill, so later versions can take over skills CLI copies of it", async () => {
		const hashes: Record<string, string[]> = publishedSkillHashes;
		const missing: string[] = [];
		for (const name of await userSkillNames(repoSkillsDir)) {
			const hash = skillHash(
				await fs.readFile(path.join(repoSkillsDir, name, "SKILL.md"), "utf8"),
			);
			if (!hashes[name]?.includes(hash)) missing.push(name);
		}
		expect(
			missing,
			"Run `pnpm skills:update-hashes` to record the edited skills",
		).toEqual([]);
	});

	it("marks the dev skills internal", async () => {
		expect(await userSkillNames(repoSkillsDir)).toEqual([
			"create-html-app",
			"edit-diagram",
			"embed-html-app",
			"review-markdown-comments",
		]);
	});
});
