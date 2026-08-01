import fsSync from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * The notepad's working text. Kept outside any workspace so closing the panel
 * mid-thought never loses it, and so a draft is not a stray file in the sidebar
 * until the capture is actually saved.
 */
let cached: string | null = null;

function draftPath() {
	return path.join(app.getPath("userData"), "capture-draft.md");
}

export function readDraft() {
	if (cached !== null) return cached;
	try {
		cached = fsSync.readFileSync(draftPath(), "utf8");
	} catch {
		cached = "";
	}
	return cached;
}

export function writeDraft(markdown: string) {
	cached = markdown;
	try {
		fsSync.writeFileSync(draftPath(), markdown);
	} catch {
		// The in-memory copy still carries the session; disk is a convenience.
	}
}

export function clearDraft() {
	cached = "";
	try {
		fsSync.rmSync(draftPath(), { force: true });
	} catch {
		// Nothing to do; a stale draft file is harmless.
	}
}
