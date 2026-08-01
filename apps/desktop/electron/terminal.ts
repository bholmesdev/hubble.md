import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ipcMain } from "electron";

export type TerminalSession = {
	id: string;
	history: string;
	write: (data: string) => void;
	resize: (cols: number, rows: number) => void;
	kill: () => void;
};

type TerminalStartPayload = {
	cwd: string;
	notePath?: string;
	initialCommand?: string;
};

const sessions: Record<string, TerminalSession> = {};
let nextSessionId = 0;
const TERMINAL_HISTORY_LIMIT = 64_000;

function appendHistory(session: TerminalSession, data: string) {
	session.history = `${session.history}${data}`.slice(-TERMINAL_HISTORY_LIMIT);
}

function getDefaultShell() {
	if (os.platform() === "win32") {
		return process.env.COMSPEC || "powershell.exe";
	}
	return process.env.SHELL || "/bin/sh";
}

function getTerminalEnv(notePath?: string) {
	return {
		...process.env,
		...(notePath ? { HUBBLE_NOTE_PATH: notePath } : {}),
	};
}

function ensureSpawnHelperExecutable() {
	// pnpm can strip the exec bit from node-pty's macOS spawn-helper binary,
	// which makes pty.spawn throw "posix_spawnp failed".
	if (os.platform() !== "darwin") return;
	try {
		const packageRoot = path.dirname(path.dirname(require.resolve("node-pty")));
		for (const dir of [
			path.join(packageRoot, "prebuilds", `darwin-${process.arch}`),
			path.join(packageRoot, "build", "Release"),
		]) {
			const helper = path.join(dir, "spawn-helper");
			if (fs.existsSync(helper)) {
				fs.chmodSync(helper, 0o755);
			}
		}
	} catch {
		// Best effort; a failed pty.spawn surfaces as terminal-start rejecting.
	}
}

function createPtySession(
	cwd: string,
	notePath: string | undefined,
	onData: (data: string) => void,
	onExit: () => void,
): TerminalSession | null {
	try {
		// node-pty is a native module: require or spawn can fail when its
		// prebuilt binary is missing or built for a different ABI. Fail soft so
		// terminal-start can reject with a readable error instead of crashing.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const pty = require("node-pty");
		ensureSpawnHelperExecutable();
		const shell = getDefaultShell();

		const ptyProcess = pty.spawn(shell, [], {
			name: "xterm-color",
			cols: 80,
			rows: 24,
			cwd: cwd,
			env: getTerminalEnv(notePath),
		});

		ptyProcess.onData((data: string) => {
			onData(data);
		});

		ptyProcess.onExit(() => {
			onExit();
		});

		return {
			id: "", // Assigned later
			history: "",
			write: (data: string) => {
				ptyProcess.write(data);
			},
			resize: (cols: number, rows: number) => {
				try {
					ptyProcess.resize(cols, rows);
				} catch {
					// Ignore resize errors if process is dying
				}
			},
			kill: () => {
				ptyProcess.kill();
			},
		};
	} catch (error) {
		console.warn("Failed to start a node-pty shell:", error);
		return null;
	}
}

export function setupTerminalIpc(
	sendToRenderer: (channel: string, ...args: unknown[]) => void,
) {
	ipcMain.handle(
		"desktop:terminal-start",
		(_event, { cwd, notePath, initialCommand }: TerminalStartPayload) => {
			const sessionId = `term-${++nextSessionId}`;
			let session: TerminalSession | null = null;
			let initialCommandTimer: NodeJS.Timeout | null = null;
			let didWriteInitialCommand = false;

			const writeInitialCommand = () => {
				if (!initialCommand || didWriteInitialCommand || !session) return;
				didWriteInitialCommand = true;
				if (initialCommandTimer) {
					clearTimeout(initialCommandTimer);
					initialCommandTimer = null;
				}
				session.write(`${initialCommand}\n`);
			};

			const onData = (data: string) => {
				if (session) appendHistory(session, data);
				sendToRenderer(`desktop:terminal-data-${sessionId}`, data);
				writeInitialCommand();
			};

			const onExit = () => {
				if (initialCommandTimer) {
					clearTimeout(initialCommandTimer);
					initialCommandTimer = null;
				}
				delete sessions[sessionId];
				sendToRenderer(`desktop:terminal-exit-${sessionId}`);
			};

			session = createPtySession(cwd, notePath, onData, onExit);
			if (!session) {
				throw new Error("The bundled shell module (node-pty) failed to load.");
			}

			session.id = sessionId;
			sessions[sessionId] = session;

			if (initialCommand) {
				initialCommandTimer = setTimeout(writeInitialCommand, 1200);
			}

			return sessionId;
		},
	);

	ipcMain.handle(
		"desktop:terminal-subscribe",
		(_event, { sessionId }: { sessionId: string }) => {
			const session = sessions[sessionId];
			if (session?.history) {
				sendToRenderer(`desktop:terminal-data-${sessionId}`, session.history);
			}
		},
	);

	ipcMain.handle(
		"desktop:terminal-write",
		(_event, { sessionId, data }: { sessionId: string; data: string }) => {
			const session = sessions[sessionId];
			if (session) {
				session.write(data);
			}
		},
	);

	ipcMain.handle(
		"desktop:terminal-resize",
		(
			_event,
			{
				sessionId,
				cols,
				rows,
			}: { sessionId: string; cols: number; rows: number },
		) => {
			const session = sessions[sessionId];
			if (session) {
				session.resize(cols, rows);
			}
		},
	);

	ipcMain.handle(
		"desktop:terminal-stop",
		(_event, { sessionId }: { sessionId: string }) => {
			const session = sessions[sessionId];
			if (session) {
				session.kill();
				delete sessions[sessionId];
			}
		},
	);
}
