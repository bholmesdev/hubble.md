#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const desktopPackagePath = "apps/desktop/package.json";
const changelogPath = "CHANGELOG.md";

function run(command, args, options = {}) {
	const output = execFileSync(command, args, {
		cwd: process.cwd(),
		encoding: "utf8",
		stdio: options.capture ? "pipe" : "inherit",
	});
	return typeof output === "string" ? output.trim() : "";
}

function fail(message) {
	throw new Error(message);
}

function parseArgs(args) {
	let version;
	let dryRun = false;
	let yes = false;

	for (const arg of args) {
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--yes") yes = true;
		else if (arg === "--help" || arg === "-h") {
			console.log("Usage: pnpm release:desktop [x.y.z] [--dry-run] [--yes]");
			process.exit(0);
		} else if (!version) version = arg.replace(/^desktop-v/, "");
		else fail(`Unexpected argument: ${arg}`);
	}

	return { version, dryRun, yes };
}

function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) fail(`Expected version x.y.z, received: ${version}`);
	return match.slice(1).map(Number);
}

function compareVersions(a, b) {
	for (let index = 0; index < 3; index += 1) {
		if (a[index] !== b[index]) return a[index] - b[index];
	}
	return 0;
}

function nextPatch(version) {
	const [major, minor, patch] = parseVersion(version);
	return `${major}.${minor}.${patch + 1}`;
}

function today() {
	const date = new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function promoteChangelog(changelog, version, date) {
	const lines = changelog.replace(/\r\n/g, "\n").split("\n");
	if (lines.some((line) => line.startsWith(`## [${version}]`))) {
		fail(`CHANGELOG.md already contains ${version}`);
	}
	const unreleasedIndex = lines.indexOf("## [Unreleased]");
	if (unreleasedIndex === -1) fail("CHANGELOG.md has no Unreleased section");

	const nextReleaseOffset = lines
		.slice(unreleasedIndex + 1)
		.findIndex((line) => /^## \[.+\]/.test(line));
	if (nextReleaseOffset === -1)
		fail("CHANGELOG.md has no release below Unreleased");
	const nextReleaseIndex = unreleasedIndex + 1 + nextReleaseOffset;

	const unreleasedLines = lines.slice(unreleasedIndex + 1, nextReleaseIndex);
	const allowedHeadings = new Set(["### Added", "### Changed", "### Fixed"]);
	const headings = [];
	for (let index = 0; index < unreleasedLines.length; index += 1) {
		if (/^### /.test(unreleasedLines[index])) {
			if (!allowedHeadings.has(unreleasedLines[index])) {
				fail(`Unexpected Unreleased heading: ${unreleasedLines[index]}`);
			}
			headings.push(index);
		}
	}
	if (headings.length === 0) fail("Unreleased has no category headings");
	if (unreleasedLines.slice(0, headings[0]).some((line) => line.trim())) {
		fail("Unreleased content must be under Added, Changed, or Fixed");
	}
	const headingNames = headings.map((index) => unreleasedLines[index]);
	if (new Set(headingNames).size !== headingNames.length) {
		fail("Unreleased contains duplicate category headings");
	}

	const sections = headings
		.map((start, index) => {
			const end = headings[index + 1] ?? unreleasedLines.length;
			const heading = unreleasedLines[start];
			const body = unreleasedLines.slice(start + 1, end);
			while (body[0]?.trim() === "") body.shift();
			while (body.at(-1)?.trim() === "") body.pop();
			return [heading, "", ...body];
		})
		.filter((section) => section.slice(1).some((line) => line.trim()));

	if (sections.length === 0) fail("Unreleased has no entries");

	const promotedLines = sections.flatMap((section, index) => [
		...(index === 0 ? [] : [""]),
		...section,
	]);

	const scaffold = [
		"## [Unreleased]",
		"",
		"### Added",
		"",
		"### Changed",
		"",
		"### Fixed",
		"",
		`## [${version}] - ${date}`,
		"",
		...promotedLines,
		"",
	];

	return [
		...lines.slice(0, unreleasedIndex),
		...scaffold,
		...lines.slice(nextReleaseIndex),
	].join("\n");
}

function verifyRepository(tag) {
	const root = run("git", ["rev-parse", "--show-toplevel"], { capture: true });
	if (resolve(root) !== resolve(process.cwd()))
		fail("Run from the repository root");
	if (run("git", ["status", "--porcelain"], { capture: true })) {
		fail("Working tree must be clean");
	}
	const branch = run("git", ["branch", "--show-current"], { capture: true });
	if (branch !== "main")
		fail(`Release from main, not ${branch || "detached HEAD"}`);

	run("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
	const head = run("git", ["rev-parse", "HEAD"], { capture: true });
	const remoteHead = run("git", ["rev-parse", "origin/main"], {
		capture: true,
	});
	if (head !== remoteHead) fail("main must match origin/main");

	if (run("git", ["tag", "--list", tag], { capture: true })) {
		fail(`Tag already exists: ${tag}`);
	}
}

async function confirmRelease(version) {
	const prompt = createInterface({ input: stdin, output: stdout });
	const answer = await prompt.question(
		`Commit, tag, and push desktop-v${version}? [y/N] `,
	);
	prompt.close();
	return /^(y|yes)$/i.test(answer.trim());
}

async function main() {
	const {
		version: requestedVersion,
		dryRun,
		yes,
	} = parseArgs(process.argv.slice(2));
	const packageText = readFileSync(desktopPackagePath, "utf8");
	const packageJson = JSON.parse(packageText);
	const currentVersion = packageJson.version;
	const version = requestedVersion ?? nextPatch(currentVersion);
	const currentParts = parseVersion(currentVersion);
	const versionParts = parseVersion(version);
	if (compareVersions(versionParts, currentParts) <= 0) {
		fail(`Version must exceed ${currentVersion}`);
	}

	const tag = `desktop-v${version}`;
	verifyRepository(tag);
	const changelog = readFileSync(changelogPath, "utf8");
	const promotedChangelog = promoteChangelog(changelog, version, today());
	const promotedSection = promotedChangelog.match(
		new RegExp(
			`## \\[${version.replaceAll(".", "\\.")}\\][\\s\\S]*?(?=\\n## \\[)`,
		),
	)?.[0];

	console.log(`Desktop ${currentVersion} → ${version}`);
	if (dryRun) {
		console.log(`\n${promotedSection?.trim() ?? ""}`);
		console.log("\nDry run; no files changed.");
		return;
	}

	const nextPackageText = packageText.replace(
		`"version": "${currentVersion}"`,
		`"version": "${version}"`,
	);
	if (nextPackageText === packageText)
		fail("Could not update desktop package version");

	writeFileSync(desktopPackagePath, nextPackageText);
	writeFileSync(changelogPath, promotedChangelog);

	let committed = false;
	let tagged = false;
	try {
		run("pnpm", ["build:desktop"]);
		const unexpectedChanges = run("git", ["status", "--porcelain"], {
			capture: true,
		})
			.split("\n")
			.filter(Boolean)
			.filter(
				(line) =>
					!line.endsWith(` ${desktopPackagePath}`) &&
					!line.endsWith(` ${changelogPath}`),
			);
		if (unexpectedChanges.length) {
			fail(
				`Build changed unexpected files; preserved for inspection:\n${unexpectedChanges.join("\n")}`,
			);
		}
		run("git", ["diff", "--check"]);
		run("git", ["diff", "--", desktopPackagePath, changelogPath]);

		if (!yes && !(await confirmRelease(version))) {
			console.log("Release cancelled.");
			return;
		}

		run("git", ["add", desktopPackagePath, changelogPath]);
		run("git", ["commit", "-m", `release desktop ${version}`]);
		committed = true;
		run("git", ["tag", tag]);
		tagged = true;
		run("git", ["push", "--atomic", "origin", "main", tag]);
		console.log(`Released ${tag}. GitHub Actions is publishing artifacts.`);
	} catch (error) {
		if (committed) {
			const recovery = tagged
				? `git push --atomic origin main ${tag}`
				: `git tag ${tag} && git push --atomic origin main ${tag}`;
			console.error(`Release commit retained. Retry with:\n${recovery}`);
		}
		throw error;
	} finally {
		if (!committed) {
			writeFileSync(desktopPackagePath, packageText);
			writeFileSync(changelogPath, changelog);
			try {
				run("git", [
					"reset",
					"--quiet",
					"--",
					desktopPackagePath,
					changelogPath,
				]);
			} catch {
				// Preserve the original files even if the index cannot be cleaned up.
			}
		}
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
