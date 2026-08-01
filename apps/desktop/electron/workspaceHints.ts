import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const gitArtifacts = new Set(["HEAD", "index"]);
const GIT_COALESCE_MS = 150;
const TERMINAL_QUIET_MS = 750;

export type Disposable = { close: () => void };

export async function resolveGitDir(root: string): Promise<string | null> {
	const candidate = path.join(root, ".git");
	let stats: Awaited<ReturnType<typeof fsp.stat>>;
	try {
		stats = await fsp.stat(candidate);
	} catch {
		return null;
	}
	if (stats.isDirectory()) return candidate;

	try {
		const pointer = /^gitdir:\s*(.+)$/m.exec(
			await fsp.readFile(candidate, "utf8"),
		);
		if (!pointer) return null;
		const target = pointer[1].trim();
		const resolved = path.isAbsolute(target)
			? target
			: path.resolve(root, target);
		return (await fsp.stat(resolved)).isDirectory() ? resolved : null;
	} catch {
		return null;
	}
}

export async function startGitWatcher(
	root: string,
	onChange: () => void,
): Promise<Disposable | null> {
	const gitDir = await resolveGitDir(root);
	if (!gitDir) return null;

	let timer: NodeJS.Timeout | null = null;
	let watcher: fs.FSWatcher;
	try {
		// Git replaces index via rename, so watching the file would retain its old inode.
		watcher = fs.watch(gitDir, { recursive: false }, (_type, filename) => {
			if (typeof filename === "string" && !gitArtifacts.has(filename)) return;
			if (timer !== null) return;
			timer = setTimeout(() => {
				timer = null;
				onChange();
			}, GIT_COALESCE_MS);
		});
	} catch (error) {
		console.error("Git watcher failed to start:", error);
		return null;
	}

	watcher.on("error", (error) => {
		console.error("Git watcher failed:", error);
	});

	return {
		close() {
			if (timer !== null) clearTimeout(timer);
			timer = null;
			watcher.close();
		},
	};
}

export function createTerminalIdleReporter(onIdle: () => void) {
	type SessionState = {
		quietTimer: NodeJS.Timeout | null;
	};
	const sessions = new Map<string, SessionState>();

	function stateFor(sessionId: string) {
		let state = sessions.get(sessionId);
		if (!state) {
			state = { quietTimer: null };
			sessions.set(sessionId, state);
		}
		return state;
	}

	function clearTimer(state: SessionState) {
		if (state.quietTimer !== null) clearTimeout(state.quietTimer);
		state.quietTimer = null;
	}

	function closeSession(sessionId: string) {
		const state = sessions.get(sessionId);
		if (!state) return;
		clearTimer(state);
		sessions.delete(sessionId);
	}

	return {
		recordInput: (sessionId: string, chunk: string) => {
			if (/[\r\n]/.test(chunk)) stateFor(sessionId);
			else closeSession(sessionId);
		},
		recordOutput: (sessionId: string, _chunk: string) => {
			const state = sessions.get(sessionId);
			if (!state) return;
			clearTimer(state);
			state.quietTimer = setTimeout(() => {
				state.quietTimer = null;
				onIdle();
			}, TERMINAL_QUIET_MS);
		},
		closeSession,
		close() {
			for (const sessionId of sessions.keys()) closeSession(sessionId);
		},
	};
}
