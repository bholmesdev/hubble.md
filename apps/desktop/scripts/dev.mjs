import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devAppDir = path.join(appDir, ".dev-electron");
const worktreeId = createHash("sha1")
	.update(path.resolve(appDir, "../.."))
	.digest("hex")
	.slice(0, 8);
const devAppName = `Hubble Dev ${worktreeId}`;
const devBundleId = `com.benholmes.hubblemd.desktop.dev.${worktreeId}`;
const devAppPath = path.join(devAppDir, `${devAppName}.app`);
const devExecPath = path.join(devAppPath, "Contents", "MacOS", devAppName);
const markerPath = path.join(devAppDir, "metadata.json");
const fixturePath = path.join(appDir, "fixtures", "playground");
const playgroundPath = path.join(devAppDir, "playground");
const wrapperVersion = 1;
const currentPlaygroundHtmlMarkers = ["bg-card", "text-foreground"];
const stalePlaygroundHtmlMarkers = ["./vendor/", "px-6"];

async function pathExists(input) {
	try {
		await fs.access(input);
		return true;
	} catch {
		return false;
	}
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: options.stdio ?? "pipe",
		encoding: "utf8",
		...options,
	});
	if (result.status === 0) return result;

	const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
	throw new Error(
		`Command failed: ${command} ${args.join(" ")}${details ? `\n${details}` : ""}`,
	);
}

function setPlistValue(plistPath, key, value) {
	const command = `/usr/libexec/PlistBuddy`;
	const setResult = spawnSync(
		command,
		["-c", `Set :${key} ${value}`, plistPath],
		{
			encoding: "utf8",
		},
	);
	if (setResult.status === 0) return;

	run(command, ["-c", `Add :${key} string ${value}`, plistPath]);
}

function electronAppPath(executablePath) {
	const marker = `${path.sep}Electron.app${path.sep}`;
	const markerIndex = executablePath.indexOf(marker);
	if (markerIndex === -1) {
		throw new Error(
			`Electron executable is not inside Electron.app: ${executablePath}`,
		);
	}
	return executablePath.slice(0, markerIndex + "Electron.app".length + 1);
}

function getElectronVersion() {
	const electronPackagePath = require.resolve("electron/package.json");
	return require(electronPackagePath).version;
}

async function readMarker() {
	try {
		return JSON.parse(await fs.readFile(markerPath, "utf8"));
	} catch {
		return null;
	}
}

async function shouldRefreshDevApp(sourceAppPath, electronVersion) {
	const marker = await readMarker();
	if (!marker) return true;
	if (marker.wrapperVersion !== wrapperVersion) return true;
	if (marker.electronVersion !== electronVersion) return true;
	if (marker.sourceAppPath !== sourceAppPath) return true;
	return !(await pathExists(devExecPath));
}

async function writeMarker(sourceAppPath, electronVersion) {
	await fs.writeFile(
		markerPath,
		JSON.stringify(
			{
				wrapperVersion,
				electronVersion,
				sourceAppPath,
				bundleId: devBundleId,
				executablePath: devExecPath,
			},
			null,
			2,
		),
	);
}

async function patchMainBundle() {
	const plistPath = path.join(devAppPath, "Contents", "Info.plist");
	const resourcesDir = path.join(devAppPath, "Contents", "Resources");
	const macosDir = path.join(devAppPath, "Contents", "MacOS");
	const sourceExecutable = path.join(macosDir, "Electron");
	const iconPath = path.join(resourcesDir, "hubble-dev.icns");

	if (await pathExists(sourceExecutable)) {
		await fs.rename(sourceExecutable, devExecPath);
	}
	await fs.copyFile(path.join(appDir, "assets", "icon.icns"), iconPath);

	setPlistValue(plistPath, "CFBundleIdentifier", devBundleId);
	setPlistValue(plistPath, "CFBundleName", devAppName);
	setPlistValue(plistPath, "CFBundleDisplayName", devAppName);
	setPlistValue(plistPath, "CFBundleExecutable", devAppName);
	setPlistValue(plistPath, "CFBundleIconFile", "hubble-dev.icns");
}

async function patchHelperBundle(helperAppPath, suffix) {
	const plistPath = path.join(helperAppPath, "Contents", "Info.plist");
	setPlistValue(
		plistPath,
		"CFBundleIdentifier",
		`${devBundleId}.helper${suffix}`,
	);
}

async function patchHelperBundles() {
	const frameworksDir = path.join(devAppPath, "Contents", "Frameworks");
	const helperSuffixes = new Map([
		["Electron Helper.app", ""],
		["Electron Helper (GPU).app", ".GPU"],
		["Electron Helper (Plugin).app", ".Plugin"],
		["Electron Helper (Renderer).app", ".Renderer"],
	]);

	for (const [helperName, suffix] of helperSuffixes) {
		const helperAppPath = path.join(frameworksDir, helperName);
		if (await pathExists(helperAppPath)) {
			await patchHelperBundle(helperAppPath, suffix);
		}
	}
}

function signAndRegisterDevApp() {
	run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", devAppPath], {
		stdio: "inherit",
	});
	run(
		"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
		["-f", devAppPath],
	);
}

async function createDevApp(sourceAppPath, electronVersion) {
	await fs.rm(devAppPath, { force: true, recursive: true });
	await fs.mkdir(devAppDir, { recursive: true });
	run("/usr/bin/ditto", [sourceAppPath, devAppPath]);
	await patchMainBundle();
	await patchHelperBundles();
	signAndRegisterDevApp();
	await writeMarker(sourceAppPath, electronVersion);
}

async function ensurePlayground() {
	if (await pathExists(playgroundPath)) return;
	await fs.mkdir(devAppDir, { recursive: true });
	await fs.cp(fixturePath, playgroundPath, { recursive: true });
}

async function ensurePlaygroundHtml() {
	const htmlPath = path.join(playgroundPath, "file-index.html");
	const fixtureHtmlPath = path.join(fixturePath, "file-index.html");
	try {
		const html = await fs.readFile(htmlPath, "utf8");
		const isCurrent = currentPlaygroundHtmlMarkers.every((marker) =>
			html.includes(marker),
		);
		const isStale = stalePlaygroundHtmlMarkers.some((marker) =>
			html.includes(marker),
		);
		if (isCurrent && !isStale) return;
	} catch {
		// Missing file gets restored from the fixture below.
	}
	await fs.copyFile(fixtureHtmlPath, htmlPath);
}

async function ensureDevApp() {
	const electronExecutablePath = require("electron");
	const sourceAppPath = electronAppPath(electronExecutablePath);
	const electronVersion = getElectronVersion();
	await fs.mkdir(devAppDir, { recursive: true });

	if (await shouldRefreshDevApp(sourceAppPath, electronVersion)) {
		console.log(`Preparing ${devAppName}.app (${devBundleId})`);
		await killExistingDevAppProcesses();
		await createDevApp(sourceAppPath, electronVersion);
	}

	return devExecPath;
}

async function killExistingDevAppProcesses() {
	if (!(await pathExists(devAppPath))) return;

	const result = run("/bin/ps", ["-axo", "pid=,args="]);
	const pids = result.stdout
		.split("\n")
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(.*)$/);
			if (!match) return null;
			const [, pid, args] = match;
			return args.includes(devAppPath) ? Number(pid) : null;
		})
		.filter((pid) => pid && pid !== process.pid);

	if (pids.length === 0) return;
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Process already exited.
		}
	}
	await new Promise((resolve) => setTimeout(resolve, 1000));
	for (const pid of pids) {
		try {
			process.kill(pid, 0);
			process.kill(pid, "SIGKILL");
		} catch {
			// Process already exited.
		}
	}
}

function startElectronVite(env) {
	const electronVitePackagePath = require.resolve("electron-vite/package.json");
	const { bin } = require(electronVitePackagePath);
	const electronViteBin = typeof bin === "string" ? bin : bin["electron-vite"];
	const electronViteCli = path.join(
		path.dirname(electronVitePackagePath),
		electronViteBin,
	);
	const child = spawn(
		process.execPath,
		[electronViteCli, "dev", ...process.argv.slice(2)],
		{
			cwd: appDir,
			env,
			stdio: "inherit",
		},
	);

	const forwardSignal = (signal) => {
		if (!child.killed) child.kill(signal);
	};
	process.on("SIGINT", () => forwardSignal("SIGINT"));
	process.on("SIGTERM", () => forwardSignal("SIGTERM"));

	child.on("exit", (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		process.exit(code ?? 0);
	});
}

const env = { ...process.env };

if (process.env.HUBBLE_DESKTOP_FRESH_START === "1") {
	await fs.mkdir(devAppDir, { recursive: true });
	env.HUBBLE_DESKTOP_DEV_USER_DATA = await fs.mkdtemp(
		path.join(devAppDir, "fresh-profile-"),
	);
	env.HUBBLE_DESKTOP_DEV_WORKSPACE = "";
	console.log(`Fresh profile: ${env.HUBBLE_DESKTOP_DEV_USER_DATA}`);
} else {
	await ensurePlayground();
	await ensurePlaygroundHtml();
}
// Default to the playground, but let an explicit env value win (set it empty
// to launch with no workspace and test the first-run welcome screen).
env.HUBBLE_DESKTOP_DEV_WORKSPACE =
	env.HUBBLE_DESKTOP_DEV_WORKSPACE ?? playgroundPath;

if (process.platform === "darwin") {
	env.ELECTRON_EXEC_PATH = await ensureDevApp();
	env.HUBBLE_DESKTOP_FORCE_DEV = "1";
	env.HUBBLE_DESKTOP_DEV_APP_NAME = devAppName;
	await killExistingDevAppProcesses();
	console.log(`Computer Use app: ${devBundleId}`);
	if (env.HUBBLE_DESKTOP_DEV_WORKSPACE) {
		console.log(`Workspace: ${env.HUBBLE_DESKTOP_DEV_WORKSPACE}`);
	} else {
		console.log("Workspace: none (welcome screen)");
	}
}

startElectronVite(env);
