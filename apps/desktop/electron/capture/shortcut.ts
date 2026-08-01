import { systemPreferences } from "electron";
import { UiohookKey, uIOhook } from "uiohook-napi";

/** Two Shift taps must land inside this window to count as a double tap. */
const DOUBLE_TAP_MS = 400;

/** Holding Shift to type a capital produces a long press, not a tap. */
const MAX_TAP_HOLD_MS = 250;

/** Set HUBBLE_CAPTURE_DEBUG_KEYS=1 to log every global key event to the dev console. */
const debugShortcut = process.env.HUBBLE_CAPTURE_DEBUG_KEYS === "1";

const SHIFT_KEYCODES = new Set<number>([
	UiohookKey.Shift,
	UiohookKey.ShiftRight,
]);

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

export function startDoubleTapShift(onDoubleTap: () => void) {
	if (state.running) return;
	if (!hasAccessibilityPermission()) return;

	uIOhook.on("keydown", (event) => {
		if (debugShortcut) console.log("[capture] keydown", event.keycode);
		if (!SHIFT_KEYCODES.has(event.keycode)) {
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
		if (!SHIFT_KEYCODES.has(event.keycode)) return;

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
}

export function stopDoubleTapShift() {
	if (!state.running) return;
	uIOhook.removeAllListeners();
	uIOhook.stop();
	state.running = false;
	state.lastTapAt = 0;
	state.pressedAt = 0;
}

export function isDoubleTapShiftRunning() {
	return state.running;
}
