#!/usr/bin/env node

// Builds the desktop app from this checkout and installs it over Hubble.app,
// for trying a branch as your everyday app. macOS only. The build is unsigned,
// so it cannot install updates; reinstall a release to get back on that track.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

const KEY = "VITE_TLDRAW_LICENSE_KEY";
const ENV_FILES = [".env.local", ".env"];
const RELEASE_DIR = "apps/desktop/release";

function run(command, args, options = {}) {
	execFileSync(command, args, { stdio: "inherit", ...options });
}

function parseArgs(args) {
	let dest = "/Applications";
	let open = true;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--dest") dest = args[++i];
		else if (arg === "--no-open") open = false;
		else if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: pnpm dogfood:desktop:mac [--dest <folder>] [--no-open]",
			);
			process.exit(0);
		} else throw new Error(`Unexpected argument: ${arg}`);
	}
	if (!dest) throw new Error("--dest needs a folder.");
	return { dest: resolve(dest), open };
}

/** The tldraw key from the environment, else the repo's env files. */
function licenseKey() {
	if (process.env[KEY]) return process.env[KEY];
	for (const file of ENV_FILES) {
		if (!existsSync(file)) continue;
		const value = parseEnv(readFileSync(file, "utf8"))[KEY];
		if (value) return value;
	}
	return undefined;
}

function isRunning() {
	try {
		execFileSync("pgrep", ["-x", "Hubble"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function quitHubble() {
	if (!isRunning()) return;
	console.log("Quitting Hubble...");
	run("osascript", ["-e", 'quit app "Hubble"']);
	const deadline = Date.now() + 15_000;
	while (isRunning()) {
		if (Date.now() > deadline) throw new Error("Hubble did not quit.");
		execFileSync("sleep", ["0.5"]);
	}
}

function builtApp() {
	const dir = readdirSync(RELEASE_DIR).find(
		(name) =>
			name.startsWith("mac") &&
			existsSync(join(RELEASE_DIR, name, "Hubble.app")),
	);
	if (!dir) throw new Error(`No Hubble.app in ${RELEASE_DIR}.`);
	return join(RELEASE_DIR, dir, "Hubble.app");
}

function main() {
	if (process.platform !== "darwin")
		throw new Error("Dogfood builds are macOS only.");
	const { dest, open } = parseArgs(process.argv.slice(2));

	const key = licenseKey();
	if (!key) {
		console.warn(
			`No ${KEY} in the environment, ${ENV_FILES.join(" or ")}. This build will leave diagrams out.`,
		);
	}
	const env = { ...process.env, ...(key && { [KEY]: key }) };

	run("pnpm", ["--filter", "@hubble.md/desktop...", "--if-present", "build"], {
		env,
	});
	rmSync(RELEASE_DIR, { recursive: true, force: true });
	run("pnpm", ["exec", "electron-builder", "--mac", "--dir"], {
		cwd: "apps/desktop",
		env: { ...env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
	});

	const app = builtApp();
	const target = join(dest, "Hubble.app");
	quitHubble();
	rmSync(target, { recursive: true, force: true });
	run("ditto", [app, target]);
	console.log(`Installed ${target}`);
	if (open) run("open", [target]);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
