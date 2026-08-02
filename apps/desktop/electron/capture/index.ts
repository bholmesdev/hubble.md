import { ipcMain } from "electron";
import { clearDraft, readDraft, writeDraft } from "./draft";
import { CaptureSession, type SessionState } from "./session";
import {
	type CaptureSettings,
	readCaptureSettings,
	writeCaptureSettings,
} from "./settings";
import {
	getDoubleTapShiftError,
	hasAccessibilityPermission,
	isDoubleTapShiftRunning,
	requestAccessibilityPermission,
	startDoubleTapShift,
	stopDoubleTapShift,
	supportsDoubleTapShift,
} from "./shortcut";
import {
	closeCaptureWindow,
	destroyCaptureWindow,
	dismissCaptureWindow,
	getCaptureWindow,
	isCaptureWindowCollapsed,
	isCaptureWindowVisible,
	sendToCaptureWindow,
	setCaptureWindowCollapsed,
	showCaptureWindow,
} from "./window";

let session: CaptureSession | null = null;
let openCapturedFile: (filePath: string) => void | Promise<void>;

function broadcastSession(state: SessionState) {
	sendToCaptureWindow("capture:session-state", state);
}

function getSession() {
	if (!session) session = new CaptureSession(broadcastSession);
	return session;
}

/** Opens the panel ready to write, clearing any finished session first. */
async function openCapturePanel() {
	const current = getSession();
	if (current.state.phase !== "idle") current.reset();
	await showCaptureWindow();
}

async function onDoubleTapShift() {
	if (isCaptureWindowVisible()) {
		setCaptureWindowCollapsed(!isCaptureWindowCollapsed());
		return;
	}
	await openCapturePanel();
}

async function syncShortcut(settings: CaptureSettings) {
	if (settings.enabled && hasAccessibilityPermission()) {
		await startDoubleTapShift(() => void onDoubleTapShift());
	} else {
		stopDoubleTapShift();
	}
}

export async function initCapture(options: {
	openCapturedFile: (filePath: string) => void | Promise<void>;
}) {
	openCapturedFile = options.openCapturedFile;
	const settings = readCaptureSettings();
	if (settings.enabled && !supportsDoubleTapShift()) {
		writeCaptureSettings({ enabled: false });
	}
	await syncShortcut(readCaptureSettings());
	registerCaptureIpc();
}

export function shutdownCapture() {
	stopDoubleTapShift();
}

function registerCaptureIpc() {
	ipcMain.handle("capture:get-state", async () => ({
		settings: readCaptureSettings(),
		hasAccessibility: hasAccessibilityPermission(),
		shortcutRunning: isDoubleTapShiftRunning(),
		shortcutError: getDoubleTapShiftError(),
		shortcutSupported: supportsDoubleTapShift(),
		session: getSession().state,
		collapsed: isCaptureWindowCollapsed(),
	}));

	ipcMain.handle(
		"capture:set-enabled",
		async (_event, { enabled }: { enabled: boolean }) => {
			const settings = writeCaptureSettings({
				enabled: enabled && supportsDoubleTapShift(),
			});
			await syncShortcut(settings);
			if (!settings.enabled) destroyCaptureWindow();
			return {
				settings,
				hasAccessibility: hasAccessibilityPermission(),
				shortcutRunning: isDoubleTapShiftRunning(),
				shortcutError: getDoubleTapShiftError(),
				shortcutSupported: supportsDoubleTapShift(),
			};
		},
	);

	ipcMain.handle(
		"capture:update-settings",
		async (_event, patch: Partial<CaptureSettings>) => {
			const settings = writeCaptureSettings(patch);
			await syncShortcut(settings);
			return settings;
		},
	);

	// The renderer owns recent-workspace ordering; mirror it so the capture
	// window can resolve a target while the main window is closed.
	ipcMain.handle(
		"capture:sync-recent-workspaces",
		(_event, { paths }: { paths: string[] }) =>
			writeCaptureSettings({ recentWorkspaces: paths }),
	);

	ipcMain.handle("capture:recheck-accessibility", async () => {
		const granted = hasAccessibilityPermission();
		await syncShortcut(readCaptureSettings());
		return {
			hasAccessibility: granted,
			shortcutRunning: isDoubleTapShiftRunning(),
			shortcutError: getDoubleTapShiftError(),
		};
	});

	ipcMain.handle("capture:request-accessibility", async () => {
		requestAccessibilityPermission();
		const granted = hasAccessibilityPermission();
		await syncShortcut(readCaptureSettings());
		return {
			hasAccessibility: granted,
			shortcutRunning: isDoubleTapShiftRunning(),
			shortcutError: getDoubleTapShiftError(),
		};
	});

	ipcMain.handle("capture:get-draft", () => readDraft());

	ipcMain.handle(
		"capture:set-draft",
		(_event, { markdown }: { markdown: string }) => {
			writeDraft(markdown);
		},
	);

	ipcMain.handle(
		"capture:save-notes",
		async (
			_event,
			{ name, saveAs }: { name: string | null; saveAs?: boolean },
		) => {
			const session = getSession();
			await session.saveNotes(name, saveAs === true);
			if (session.state.phase === "saved") {
				await openCapturedFile(session.state.filePath);
				await dismissCaptureWindow();
			}
			return session.state;
		},
	);

	ipcMain.handle("capture:close-window", () => {
		closeCaptureWindow();
	});

	ipcMain.handle(
		"capture:set-collapsed",
		(_event, { collapsed }: { collapsed: boolean }) => {
			setCaptureWindowCollapsed(collapsed);
		},
	);

	ipcMain.handle("capture:discard-draft", () => {
		clearDraft();
		getSession().reset();
	});

	// The pill drags itself by hand (a native drag region would swallow the
	// click that expands it), so the renderer streams positions here.
	ipcMain.handle(
		"capture:move-window",
		(_event, { x, y }: { x: number; y: number }) => {
			const window = getCaptureWindow();
			if (window && !window.isDestroyed()) window.setPosition(x, y);
		},
	);

	// A BrowserWindow cannot cross IPC, so resolve with nothing.
	ipcMain.handle("capture:show-window", async () => {
		await openCapturePanel();
	});
}
