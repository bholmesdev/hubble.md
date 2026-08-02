import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FRONTMOST_SCRIPT = `
ObjC.import("AppKit");
function run() {
	const application = $.NSWorkspace.sharedWorkspace.frontmostApplication;
	if (!application) return "";
	return JSON.stringify({
		processIdentifier: Number(application.processIdentifier),
		bundleIdentifier: application.bundleIdentifier
			? ObjC.unwrap(application.bundleIdentifier)
			: null,
	});
}`;

const ACTIVATE_SCRIPT = `
ObjC.import("AppKit");
function run(arguments) {
	const processIdentifier = Number(arguments[0]);
	const bundleIdentifier = arguments[1];
	const byProcess = $.NSRunningApplication.runningApplicationWithProcessIdentifier(
		processIdentifier,
	);
	const application = byProcess || (bundleIdentifier
		? $.NSRunningApplication.runningApplicationsWithBundleIdentifier(
			$(bundleIdentifier),
		).firstObject
		: null);
	if (!application) return "false";
	return String(Boolean(application.activateWithOptions(
		$.NSApplicationActivateIgnoringOtherApps,
	)));
}`;

export type FrontmostApp = {
	processIdentifier: number;
	bundleIdentifier: string | null;
};

async function runScript(script: string, ...args: string[]) {
	const { stdout } = await execFileAsync(
		"/usr/bin/osascript",
		["-l", "JavaScript", "-e", script, "--", ...args],
		{ encoding: "utf8", timeout: 1000 },
	);
	return stdout.trim();
}

export async function getFrontmostApp() {
	if (process.platform !== "darwin") return null;
	try {
		const parsed = JSON.parse(
			await runScript(FRONTMOST_SCRIPT),
		) as Partial<FrontmostApp>;
		if (
			typeof parsed.processIdentifier !== "number" ||
			parsed.processIdentifier === process.pid
		) {
			return null;
		}
		return {
			processIdentifier: parsed.processIdentifier,
			bundleIdentifier:
				typeof parsed.bundleIdentifier === "string"
					? parsed.bundleIdentifier
					: null,
		};
	} catch {
		return null;
	}
}

export async function focusApp(target: FrontmostApp) {
	if (process.platform !== "darwin") return;
	try {
		await runScript(
			ACTIVATE_SCRIPT,
			String(target.processIdentifier),
			target.bundleIdentifier ?? "",
		);
	} catch {
		// The previous app may have quit while capture was open.
	}
}
