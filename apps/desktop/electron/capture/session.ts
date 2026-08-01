import fsp from "node:fs/promises";
import path from "node:path";
import { app, dialog } from "electron";
import { clearDraft, readDraft } from "./draft";
import { resolveTargetWorkspace } from "./settings";
import { getCaptureWindow } from "./window";

const CAPTURES_FOLDER = "Captures";

export type SessionState =
	| { phase: "idle" }
	| { phase: "saved"; filePath: string }
	| { phase: "error"; message: string };

/** Owns one capture from notepad draft to written markdown. */
export class CaptureSession {
	state: SessionState = { phase: "idle" };

	constructor(private onStateChange: (state: SessionState) => void) {}

	private setState(state: SessionState) {
		this.state = state;
		this.onStateChange(state);
	}

	reset() {
		this.setState({ phase: "idle" });
	}

	async saveNotes() {
		const notes = readDraft().trim();
		if (!notes) return;
		try {
			const filePath = await writeCaptureNote(notes);
			// A dismissed save dialog keeps the draft for another try.
			if (!filePath) return;
			clearDraft();
			this.setState({ phase: "saved", filePath });
		} catch (error) {
			this.setState({
				phase: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function pad(value: number) {
	return String(value).padStart(2, "0");
}

function formatStamp(date: Date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Appends a numeric suffix so two captures in the same minute never collide. */
async function uniquePath(dir: string, stem: string, extension: string) {
	for (let attempt = 0; ; attempt++) {
		const name =
			attempt === 0 ? `${stem}${extension}` : `${stem}-${attempt}${extension}`;
		const candidate = path.join(dir, name);
		try {
			await fsp.access(candidate);
		} catch {
			return candidate;
		}
	}
}

/** With no workspace to land in, the user picks a spot on disk directly. */
async function askForCapturePath(stem: string) {
	const captureWindow = getCaptureWindow();
	const options = {
		title: "Save capture",
		defaultPath: path.join(app.getPath("documents"), `${stem}.md`),
		filters: [{ name: "Markdown", extensions: ["md"] }],
	};
	const { canceled, filePath } = captureWindow
		? await dialog.showSaveDialog(captureWindow, options)
		: await dialog.showSaveDialog(options);
	return canceled || !filePath ? null : filePath;
}

async function writeCaptureNote(notes: string) {
	const started = new Date();
	const stem = formatStamp(started);

	const workspace = resolveTargetWorkspace();
	let filePath: string;
	if (workspace) {
		const dir = path.join(workspace, CAPTURES_FOLDER);
		await fsp.mkdir(dir, { recursive: true });
		filePath = await uniquePath(dir, stem, ".md");
	} else {
		const picked = await askForCapturePath(stem);
		if (!picked) return null;
		filePath = picked;
	}

	const frontMatter = [
		"---",
		`created: ${started.toISOString()}`,
		"source: capture",
		"---",
	].join("\n");

	const body = stripFrontMatter(notes).trim() || "_Nothing captured._";

	await fsp.writeFile(filePath, `${frontMatter}\n\n${body}\n`, "utf8");
	return filePath;
}

/** The notepad round-trips through the editor, which may add its own front matter. */
function stripFrontMatter(markdown: string) {
	if (!markdown.startsWith("---\n")) return markdown;
	const end = markdown.indexOf("\n---", 4);
	return end === -1 ? markdown : markdown.slice(end + 4);
}
