import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, screen } from "electron";

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 460;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;

/** Inset from the corner of the work area when the panel has no saved spot. */
const EDGE_MARGIN = 24;

const SAVE_DEBOUNCE_MS = 300;

type CaptureBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

let captureWindow: BrowserWindow | null = null;
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;

export function getCaptureWindow() {
	return captureWindow;
}

function boundsPath() {
	return path.join(app.getPath("userData"), "capture-window.json");
}

function isSaneBounds(value: unknown): value is CaptureBounds {
	if (!value || typeof value !== "object") return false;
	const bounds = value as Record<string, unknown>;
	return (
		typeof bounds.x === "number" &&
		typeof bounds.y === "number" &&
		typeof bounds.width === "number" &&
		typeof bounds.height === "number" &&
		bounds.width >= MIN_WIDTH &&
		bounds.height >= MIN_HEIGHT
	);
}

/**
 * A saved spot is only usable if it still overlaps a connected display —
 * otherwise unplugging a monitor would strand the panel offscreen.
 */
function isOnSomeDisplay(bounds: CaptureBounds) {
	return screen.getAllDisplays().some(({ workArea }) => {
		const overlapX =
			Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
			Math.max(bounds.x, workArea.x);
		const overlapY =
			Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
			Math.max(bounds.y, workArea.y);
		return overlapX > 40 && overlapY > 40;
	});
}

/** Bottom right of the display holding the pointer, inset from both edges. */
function defaultBounds(): CaptureBounds {
	const cursor = screen.getCursorScreenPoint();
	const { workArea } = screen.getDisplayNearestPoint(cursor);
	return {
		x: workArea.x + workArea.width - DEFAULT_WIDTH - EDGE_MARGIN,
		y: workArea.y + workArea.height - DEFAULT_HEIGHT - EDGE_MARGIN,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT,
	};
}

async function loadBounds(): Promise<CaptureBounds> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(boundsPath(), "utf8"));
		if (isSaneBounds(parsed) && isOnSomeDisplay(parsed)) return parsed;
	} catch {
		// A missing or malformed spot just means we fall back to the corner.
	}
	return defaultBounds();
}

function saveBounds(window: BrowserWindow) {
	if (window.isDestroyed() || window.isMinimized()) return;
	try {
		fsSync.writeFileSync(
			boundsPath(),
			JSON.stringify(window.getNormalBounds(), null, 2),
		);
	} catch {
		// Best-effort: losing the remembered spot must not break a capture.
	}
}

function queueSaveBounds(window: BrowserWindow) {
	if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
	saveBoundsTimer = setTimeout(() => {
		saveBoundsTimer = null;
		saveBounds(window);
	}, SAVE_DEBOUNCE_MS);
}

async function createCaptureWindow() {
	const bounds = await loadBounds();
	const window = new BrowserWindow({
		...bounds,
		minWidth: MIN_WIDTH,
		minHeight: MIN_HEIGHT,
		show: false,
		frame: false,
		resizable: true,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		transparent: true,
		backgroundColor: "#00000000",
		hasShadow: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, "../preload/preload.mjs"),
			sandbox: false,
		},
	});
	captureWindow = window;

	// Float above fullscreen apps so capture works without leaving what you were doing.
	window.setAlwaysOnTop(true, "floating");
	window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.on("move", () => queueSaveBounds(window));
	window.on("resize", () => queueSaveBounds(window));
	window.on("closed", () => {
		if (captureWindow === window) captureWindow = null;
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/capture.html`);
	} else {
		await window.loadFile(path.join(__dirname, "../renderer/capture.html"));
	}
	return window;
}

export async function showCaptureWindow() {
	const window = captureWindow ?? (await createCaptureWindow());
	// Reopening keeps wherever it was dragged to; only an offscreen spot resets.
	const bounds = window.getNormalBounds();
	if (!isOnSomeDisplay(bounds)) window.setBounds(defaultBounds());
	window.show();
	window.focus();
	window.webContents.send("capture:window-shown");
	return window;
}

export function hideCaptureWindow() {
	if (!captureWindow || captureWindow.isDestroyed()) return;
	// Flush the pending debounce so a drag right before hiding is not lost.
	if (saveBoundsTimer) {
		clearTimeout(saveBoundsTimer);
		saveBoundsTimer = null;
		saveBounds(captureWindow);
	}
	captureWindow.hide();
}

export function isCaptureWindowVisible() {
	return captureWindow?.isVisible() === true;
}

export function sendToCaptureWindow(channel: string, ...args: unknown[]) {
	if (captureWindow && !captureWindow.isDestroyed()) {
		captureWindow.webContents.send(channel, ...args);
	}
}
