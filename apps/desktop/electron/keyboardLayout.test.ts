import { describe, expect, it, vi } from "vitest";
import { KeyboardLayoutMonitor } from "./keyboardLayout";

describe("KeyboardLayoutMonitor", () => {
	it("tracks startup and live switches between standard and hybrid Dvorak", async () => {
		let id = "com.apple.keylayout.Dvorak";
		let changed = () => {};
		const onChange = vi.fn();
		const monitor = new KeyboardLayoutMonitor("darwin", onChange);
		await monitor.initialize(async () => ({
			getCurrentKeyboardLayout: () => ({ id }),
			onDidChangeKeyboardLayout: (callback) => {
				changed = callback;
			},
		}));
		expect(monitor.qwertyCommandKeys).toBe(false);
		id = "com.apple.keylayout.DVORAK-QWERTYCMD";
		changed();
		expect(monitor.qwertyCommandKeys).toBe(true);
		expect(onChange).toHaveBeenLastCalledWith(true);
		id = "com.apple.keylayout.US";
		changed();
		expect(monitor.qwertyCommandKeys).toBe(false);
		expect(onChange).toHaveBeenLastCalledWith(false);
	});

	it("uses hybrid positions before the first renderer event", async () => {
		const monitor = new KeyboardLayoutMonitor("darwin", vi.fn());
		await monitor.initialize(async () => ({
			getCurrentKeyboardLayout: () => ({
				id: "com.apple.keylayout.DVORAK-QWERTYCMD",
			}),
			onDidChangeKeyboardLayout: vi.fn(),
		}));
		expect(monitor.qwertyCommandKeys).toBe(true);
	});

	it.each([
		"win32",
		"linux",
	])("does not load native detection on %s", async (platform) => {
		const load = vi.fn();
		const monitor = new KeyboardLayoutMonitor(platform, vi.fn());
		await monitor.initialize(load);
		expect(load).not.toHaveBeenCalled();
		expect(monitor.qwertyCommandKeys).toBe(false);
	});

	it("preserves existing Command positions when native detection fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const monitor = new KeyboardLayoutMonitor("darwin", vi.fn());
			await monitor.initialize(async () => {
				throw new Error("missing optional module");
			});
			expect(monitor.qwertyCommandKeys).toBe(true);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("keeps the last mode after an unreadable layout and recovers on the next change", async () => {
		let layout: { id: string } | null = { id: "com.apple.keylayout.US" };
		let changed = () => {};
		const monitor = new KeyboardLayoutMonitor("darwin", vi.fn());
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await monitor.initialize(async () => ({
				getCurrentKeyboardLayout: () => layout,
				onDidChangeKeyboardLayout: (callback) => {
					changed = callback;
				},
			}));
			layout = null;
			changed();
			expect(monitor.qwertyCommandKeys).toBe(false);
			layout = { id: "com.apple.keylayout.DVORAK-QWERTYCMD" };
			changed();
			expect(monitor.qwertyCommandKeys).toBe(true);
		} finally {
			warn.mockRestore();
		}
	});
});
