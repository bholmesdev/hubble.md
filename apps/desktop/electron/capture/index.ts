import { ipcMain } from "electron";
import { clearDraft, readDraft, writeDraft } from "./draft";
import { CaptureSession, type SessionState } from "./session";
import {
	type CaptureSettings,
	readCaptureSettings,
	writeCaptureSettings,
} from "./settings";
import {
	hasAccessibilityPermission,
	isDoubleTapShiftRunning,
	requestAccessibilityPermission,
	startDoubleTapShift,
	stopDoubleTapShift,
} from "./shortcut";
import {
	hideCaptureWindow,
	isCaptureWindowCollapsed,
	isCaptureWindowVisible,
	sendToCaptureWindow,
	setCaptureWindowCollapsed,
	showCaptureWindow,
} from "./window";

let session: CaptureSession | null = null;

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

/** A double tap toggles the panel open and closed. */
async function onDoubleTapShift() {
	if (isCaptureWindowVisible()) {
		hideCaptureWindow();
		return;
	}
	await openCapturePanel();
}

function syncShortcut(settings: CaptureSettings) {
	if (settings.enabled && hasAccessibilityPermission()) {
		startDoubleTapShift(() => void onDoubleTapShift());
	} else {
		stopDoubleTapShift();
	}
}

export async function initCapture() {
	syncShortcut(readCaptureSettings());
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
		session: getSession().state,
		collapsed: isCaptureWindowCollapsed(),
	}));

	ipcMain.handle(
		"capture:set-enabled",
		async (_event, { enabled }: { enabled: boolean }) => {
			const settings = writeCaptureSettings({ enabled });
			if (enabled && !hasAccessibilityPermission()) {
				requestAccessibilityPermission();
			}
			syncShortcut(settings);
			return {
				settings,
				hasAccessibility: hasAccessibilityPermission(),
				shortcutRunning: isDoubleTapShiftRunning(),
			};
		},
	);

	ipcMain.handle(
		"capture:update-settings",
		(_event, patch: Partial<CaptureSettings>) => {
			const settings = writeCaptureSettings(patch);
			syncShortcut(settings);
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

	ipcMain.handle("capture:recheck-accessibility", () => {
		const granted = hasAccessibilityPermission();
		syncShortcut(readCaptureSettings());
		return {
			hasAccessibility: granted,
			shortcutRunning: isDoubleTapShiftRunning(),
		};
	});

	ipcMain.handle("capture:get-draft", () => readDraft());

	ipcMain.handle(
		"capture:set-draft",
		(_event, { markdown }: { markdown: string }) => {
			writeDraft(markdown);
		},
	);

	ipcMain.handle("capture:save-notes", async () => {
		await getSession().saveNotes();
		return getSession().state;
	});

	ipcMain.handle("capture:hide-window", () => {
		hideCaptureWindow();
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

	// A BrowserWindow cannot cross IPC, so resolve with nothing.
	ipcMain.handle("capture:show-window", async () => {
		await openCapturePanel();
	});
}
