import { afterEach, describe, expect, it, vi } from "vitest";

const isMac = vi.fn();
vi.mock("keymatch", () => ({ isMac: () => isMac() }));

const { formatShortcut } = await import("./shortcut");

afterEach(() => {
	isMac.mockReset();
});

describe("formatShortcut", () => {
	it("renders adjacent glyphs on macOS", () => {
		isMac.mockReturnValue(true);
		expect(formatShortcut("CmdOrCtrl+N")).toBe("⌘N");
		expect(formatShortcut("CmdOrCtrl+Alt+R")).toBe("⌘⌥R");
		expect(formatShortcut("CmdOrCtrl+Shift+C")).toBe("⌘⇧C");
		expect(formatShortcut("CmdOrCtrl+Backspace")).toBe("⌘⌫");
	});

	it("renders +-joined words on Windows/Linux", () => {
		isMac.mockReturnValue(false);
		expect(formatShortcut("CmdOrCtrl+N")).toBe("Ctrl+N");
		expect(formatShortcut("CmdOrCtrl+Alt+R")).toBe("Ctrl+Alt+R");
		expect(formatShortcut("CmdOrCtrl+Shift+C")).toBe("Ctrl+Shift+C");
		expect(formatShortcut("CmdOrCtrl+Backspace")).toBe("Ctrl+Backspace");
	});

	it("uppercases bare letter keys and leaves other keys intact", () => {
		isMac.mockReturnValue(false);
		expect(formatShortcut("CmdOrCtrl+,")).toBe("Ctrl+,");
		expect(formatShortcut("Alt+Enter")).toBe("Alt+Enter");
	});
});
