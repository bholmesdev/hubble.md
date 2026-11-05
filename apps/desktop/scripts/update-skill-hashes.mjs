// Adds the current SKILL.md hash of each user-facing skill to
// electron/publishedSkillHashes.json. Hubble updates a skills CLI copy only
// when its SKILL.md matches a published hash, so entries are only ever added:
// dropping one would strand anyone still on that version.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skillHash, userSkillNames } from "../electron/agentSkills.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = path.resolve(appDir, "../../.agents/skills");
const hashesPath = path.join(appDir, "electron", "publishedSkillHashes.json");

const hashes = JSON.parse(await fs.readFile(hashesPath, "utf8"));
const added = [];
for (const name of await userSkillNames(skillsDir)) {
	const skillMd = await fs.readFile(
		path.join(skillsDir, name, "SKILL.md"),
		"utf8",
	);
	const hash = skillHash(skillMd);
	hashes[name] ??= [];
	if (hashes[name].includes(hash)) continue;
	hashes[name].push(hash);
	hashes[name].sort();
	added.push(name);
}

const sorted = Object.fromEntries(
	Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)),
);
await fs.writeFile(hashesPath, `${JSON.stringify(sorted, null, "\t")}\n`);
console.log(
	added.length > 0
		? `Recorded new hashes for: ${added.join(", ")}`
		: "All skill hashes are already recorded.",
);
