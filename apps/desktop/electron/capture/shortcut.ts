import { systemPreferences } from "electron";

type HookModule = typeof import("uiohook-napi");

/** Two Shift taps must land inside this window to count as a double tap. */
const DOUBLE_TAP_MS = 400;

/** Holding Shift to type a capital produces a long press, not a tap. */
const MAX_TAP_HOLD_MS = 250;

/** Set HUBBLE_CAPTURE_DEBUG_KEYS=1 to log every global key event to the dev console. */
const debugShortcut = process.env.HUBBLE_CAPTURE_DEBUG_KEYS === "1";

type HookState = {
	running: boolean;
	lastTapAt: number;
	pressedAt: number;
	otherKeyDuringPress: boolean;
};

const state: HookState = {
	running: false,
	lastTapAt: 0,
	pressedAt: 0,
	otherKeyDuringPress: false,
};
let shortcutError: string | null = null;
let hookModule: HookModule | null = null;
let starting = false;
let runVersion = 0;

export function supportsDoubleTapShift() {
	return doubleTapShiftUnsupportedReason() === null;
}

function doubleTapShiftUnsupportedReason() {
	if (process.platform === "darwin" || process.platform === "win32") {
		return process.arch === "arm64" || process.arch === "x64"
			? null
			: "Capture does not support this system architecture.";
	}
	if (process.platform !== "linux" || process.arch !== "x64") {
		return "Capture does not support this system.";
	}
	if (
		process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland" ||
		process.env.WAYLAND_DISPLAY
	) {
		return "Capture requires an X11 session on Linux.";
	}
	return null;
}

/**
 * macOS gates system-wide key listening behind Accessibility. There is no grant
 * callback, so callers poll this after sending the user to System Settings.
 */
export function hasAccessibilityPermission() {
	if (process.platform !== "darwin") return true;
	return systemPreferences.isTrustedAccessibilityClient(false);
}

/** Shows the system prompt. It only opens System Settings; it never grants. */
export function requestAccessibilityPermission() {
	if (process.platform !== "darwin") return true;
	return systemPreferences.isTrustedAccessibilityClient(true);
}

export async function startDoubleTapShift(onDoubleTap: () => void) {
	if (state.running || starting) return;
	if (!hasAccessibilityPermission()) return;
	if (!supportsDoubleTapShift()) {
		shortcutError = "This system does not support the global Shift shortcut.";
		return;
	}
	starting = true;
	const version = ++runVersion;

	try {
		hookModule ??= await import("uiohook-napi");
		if (version !== runVersion) return;
		const { UiohookKey, uIOhook } = hookModule;
		const shiftKeycodes = new Set<number>([
			UiohookKey.Shift,
			UiohookKey.ShiftRight,
		]);

		uIOhook.on("keydown", (event) => {
			if (debugShortcut) console.log("[capture] keydown", event.keycode);
			if (!shiftKeycodes.has(event.keycode)) {
				// Any other key means Shift is being used as a modifier, not tapped.
				state.otherKeyDuringPress = true;
				state.lastTapAt = 0;
				return;
			}
			// Key repeat fires keydown continuously while held; keep the first press.
			if (state.pressedAt === 0) {
				state.pressedAt = Date.now();
				state.otherKeyDuringPress = false;
			}
		});

		uIOhook.on("keyup", (event) => {
			if (debugShortcut) console.log("[capture] keyup", event.keycode);
			if (!shiftKeycodes.has(event.keycode)) return;

			const now = Date.now();
			const heldFor = now - state.pressedAt;
			state.pressedAt = 0;

			const wasTap = !state.otherKeyDuringPress && heldFor <= MAX_TAP_HOLD_MS;
			state.otherKeyDuringPress = false;
			if (!wasTap) {
				state.lastTapAt = 0;
				return;
			}

			if (state.lastTapAt && now - state.lastTapAt <= DOUBLE_TAP_MS) {
				state.lastTapAt = 0;
				onDoubleTap();
				return;
			}
			state.lastTapAt = now;
		});

		uIOhook.start();
		state.running = true;
		shortcutError = null;
	} catch (error) {
		hookModule?.uIOhook.removeAllListeners();
		console.warn("[capture] global shortcut unavailable", error);
		shortcutError = "This system does not support the global Shift shortcut.";
	} finally {
		starting = false;
	}
}

export function stopDoubleTapShift() {
	runVersion++;
	const hook = hookModule?.uIOhook;
	hook?.removeAllListeners();
	if (state.running) {
		try {
			hook?.stop();
		} catch {
			// The native hook has already stopped, so local cleanup is enough.
		}
	}
	state.running = false;
	state.lastTapAt = 0;
	state.pressedAt = 0;
	state.otherKeyDuringPress = false;
	shortcutError = null;
}

export function isDoubleTapShiftRunning() {
	return state.running;
}

export function getDoubleTapShiftError() {
	return doubleTapShiftUnsupportedReason() ?? shortcutError;
}
