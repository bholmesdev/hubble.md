import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, screen } from "electron";
import { type FrontmostApp, focusApp, getFrontmostApp } from "./frontmostApp";

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 460;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;

/** Inset from the corner of the work area when the panel has no saved spot. */
const EDGE_MARGIN = 24;

/** Size of the collapsed pill the panel shrinks into. */
const PILL_WIDTH = 220;
const PILL_HEIGHT = 36;

const SAVE_DEBOUNCE_MS = 300;
const FOCUS_SETTLE_MS = 75;

type CaptureBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

let captureWindow: BrowserWindow | null = null;
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
let collapsed = false;
/** Size to restore when the pill expands back into the panel. */
let expandedSize = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
let quitting = false;
let previousApp: FrontmostApp | null = null;
let dismissing: Promise<void> | null = null;

app.on("before-quit", () => {
	quitting = true;
});

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
	// Pill bounds are derived, never the panel's remembered spot.
	if (collapsed) return;
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
		// A non-activating macOS panel takes key focus without activating the
		// app, so opening and closing it never drags the main window forward.
		...(process.platform === "darwin" ? { type: "panel" as const } : {}),
		minWidth: MIN_WIDTH,
		minHeight: MIN_HEIGHT,
		show: false,
		frame: false,
		resizable: true,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		...(process.platform === "win32" ? { skipTaskbar: true } : {}),
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
	if (process.platform === "linux") window.setVisibleOnAllWorkspaces(true);
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.on("move", () => queueSaveBounds(window));
	window.on("resize", () => queueSaveBounds(window));
	// Cmd+W and the menu route through close; the draft survives hiding, so
	// closing just puts the panel away instead of destroying the window.
	window.on("close", (event) => {
		if (quitting) return;
		event.preventDefault();
		void dismissCaptureWindow();
	});
	window.on("closed", () => {
		if (captureWindow === window) captureWindow = null;
		collapsed = false;
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/capture.html`);
	} else {
		await window.loadFile(path.join(__dirname, "../renderer/capture.html"));
	}
	return window;
}

export async function showCaptureWindow() {
	previousApp = await getFrontmostApp();
	const window = captureWindow ?? (await createCaptureWindow());
	// Summoning the panel means writing, so a collapsed pill expands first.
	setCaptureWindowCollapsed(false);
	// Reopening keeps wherever it was dragged to; only an offscreen spot resets.
	const bounds = window.getNormalBounds();
	if (!isOnSomeDisplay(bounds)) window.setBounds(defaultBounds());
	if (process.platform === "darwin") {
		// show() activates Hubble before the panel can take key focus.
		window.showInactive();
	} else {
		window.show();
	}
	window.focus();
	window.webContents.send("capture:window-shown");
	return window;
}

export function dismissCaptureWindow() {
	if (dismissing) return dismissing;
	dismissing = runDismiss().finally(() => {
		dismissing = null;
	});
	return dismissing;
}

async function runDismiss() {
	const window = captureWindow;
	if (!window || window.isDestroyed()) return;
	// Flush the pending debounce so a drag right before hiding is not lost.
	if (saveBoundsTimer) {
		clearTimeout(saveBoundsTimer);
		saveBoundsTimer = null;
		saveBounds(window);
	}
	const appToRestore = previousApp;
	previousApp = null;
	if (appToRestore) {
		await focusApp(appToRestore);
		// Let AppKit switch apps before hiding the active capture window.
		await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS));
	}
	if (!window.isDestroyed()) window.hide();
}

export function closeCaptureWindow() {
	if (!captureWindow || captureWindow.isDestroyed()) return;
	captureWindow.close();
}

export function destroyCaptureWindow() {
	if (!captureWindow || captureWindow.isDestroyed()) return;
	captureWindow.destroy();
}

export function isCaptureWindowVisible() {
	return captureWindow?.isVisible() === true;
}

export function isCaptureWindowCollapsed() {
	return collapsed;
}

function clampToDisplay(bounds: CaptureBounds): CaptureBounds {
	const { workArea } = screen.getDisplayMatching(bounds);
	return {
		...bounds,
		x: Math.max(
			workArea.x,
			Math.min(bounds.x, workArea.x + workArea.width - bounds.width),
		),
		y: Math.max(
			workArea.y,
			Math.min(bounds.y, workArea.y + workArea.height - bounds.height),
		),
	};
}

/**
 * Shrinks the panel into a pill anchored to its bottom-right corner, or grows
 * it back out from the same anchor.
 */
export function setCaptureWindowCollapsed(next: boolean) {
	const window = captureWindow;
	if (!window || window.isDestroyed() || next === collapsed) return;
	collapsed = next;
	const bounds = window.getNormalBounds();
	if (next) {
		expandedSize = { width: bounds.width, height: bounds.height };
		window.setResizable(false);
		window.setMinimumSize(PILL_WIDTH, PILL_HEIGHT);
		window.setBounds({
			x: bounds.x + bounds.width - PILL_WIDTH,
			y: bounds.y + bounds.height - PILL_HEIGHT,
			width: PILL_WIDTH,
			height: PILL_HEIGHT,
		});
	} else {
		window.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
		window.setResizable(true);
		window.setBounds(
			clampToDisplay({
				x: bounds.x + bounds.width - expandedSize.width,
				y: bounds.y + bounds.height - expandedSize.height,
				...expandedSize,
			}),
		);
	}
	window.webContents.send("capture:collapsed-changed", collapsed);
}

export function sendToCaptureWindow(channel: string, ...args: unknown[]) {
	if (captureWindow && !captureWindow.isDestroyed()) {
		captureWindow.webContents.send(channel, ...args);
	}
}
