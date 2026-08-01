import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type CaptureSettings = {
	enabled: boolean;
	/** Workspace folder captures are written to. Null falls back to the most recent. */
	targetWorkspace: string | null;
	/**
	 * Mirrored from the renderer, which owns recent-workspace ordering. The
	 * capture window needs this list while the main window may be closed.
	 */
	recentWorkspaces: string[];
};

const DEFAULTS: CaptureSettings = {
	enabled: false,
	targetWorkspace: null,
	recentWorkspaces: [],
};

let cached: CaptureSettings | null = null;

function settingsPath() {
	return path.join(app.getPath("userData"), "capture.json");
}

export function readCaptureSettings(): CaptureSettings {
	if (cached) return cached;
	try {
		const raw = JSON.parse(
			fs.readFileSync(settingsPath(), "utf8"),
		) as Partial<CaptureSettings>;
		cached = {
			enabled: raw.enabled === true,
			targetWorkspace:
				typeof raw.targetWorkspace === "string" ? raw.targetWorkspace : null,
			recentWorkspaces: Array.isArray(raw.recentWorkspaces)
				? raw.recentWorkspaces.filter((entry) => typeof entry === "string")
				: [],
		};
	} catch {
		cached = { ...DEFAULTS };
	}
	return cached;
}

export function writeCaptureSettings(patch: Partial<CaptureSettings>) {
	const next = { ...readCaptureSettings(), ...patch };
	cached = next;
	try {
		fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
	} catch {
		// Settings are a convenience; a failed write should not break capture.
	}
	return next;
}

function isUsableWorkspace(dir: string | null): dir is string {
	if (!dir) return false;
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

/**
 * The workspace a capture should land in: an explicit pick, then the most
 * recent workspace still on disk. Null means the caller must ask for a path.
 */
export function resolveTargetWorkspace() {
	const { targetWorkspace, recentWorkspaces } = readCaptureSettings();
	if (isUsableWorkspace(targetWorkspace)) return targetWorkspace;
	return recentWorkspaces.find(isUsableWorkspace) ?? null;
}
