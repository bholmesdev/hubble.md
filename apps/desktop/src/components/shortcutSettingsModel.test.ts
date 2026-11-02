// @vitest-environment happy-dom

import { formatShortcut } from "@hubble.md/ui";
import { keymatch } from "keymatch";
import { describe, expect, it } from "vitest";

Object.defineProperty(window, "desktopApi", { value: {} });

const {
	filterShortcutGroups,
	isShortcutCustomized,
	shortcutBindingFromEvent,
	validateShortcutBinding,
} = await import("./shortcutSettingsModel");

describe("filterShortcutGroups", () => {
	it("omits groups with no search matches", () => {
		const groups = filterShortcutGroups("workspace");

		expect(groups.map((group) => group.area)).toEqual(["App"]);
		expect(groups[0]?.commands.length).toBeGreaterThan(0);
	});

	it("returns no empty group headers", () => {
		expect(filterShortcutGroups("no such shortcut")).toEqual([]);
	});

	it("matches current bindings in raw and display form", () => {
		const bindings = { "app.new-file": "CmdOrCtrl+Alt+N" } as const;

		expect(
			filterShortcutGroups("CmdOrCtrl+Alt+N", bindings)[0]?.commands[0]?.id,
		).toBe("app.new-file");
		expect(
			filterShortcutGroups(formatShortcut("CmdOrCtrl+Alt+N"), bindings)[0]
				?.commands[0]?.id,
		).toBe("app.new-file");
	});

	it("does not mark reordered registry modifiers as custom", () => {
		expect(
			isShortcutCustomized("app.toggle-source-mode", {
				"app.toggle-source-mode": "CmdOrCtrl+Alt+U",
			}),
		).toBe(false);
		expect(
			isShortcutCustomized("app.toggle-source-mode", {
				"app.toggle-source-mode": null,
			}),
		).toBe(true);
	});
});

describe("validateShortcutBinding", () => {
	it("rejects keys Electron cannot use as accelerators", () => {
		expect(validateShortcutBinding("CmdOrCtrl+Alt+Æ", true)).toBe(
			"That key cannot be used in a Hubble shortcut.",
		);
		expect(validateShortcutBinding("CmdOrCtrl+Alt+[", true)).toBeUndefined();
	});

	it("keeps application and terminal bindings fixed", () => {
		expect(validateShortcutBinding("CmdOrCtrl+Q", true)).toContain(
			"stays fixed",
		);
		expect(validateShortcutBinding("Ctrl+`", true)).toContain("stays fixed");
		expect(validateShortcutBinding("CmdOrCtrl+Q", false)).toBeUndefined();
	});

	it("rejects operating system shortcuts by platform", () => {
		expect(validateShortcutBinding("CmdOrCtrl+`", true)).toContain(
			"operating system",
		);
		expect(validateShortcutBinding("CmdOrCtrl+Shift+4", true)).toContain(
			"operating system",
		);
		expect(validateShortcutBinding("CmdOrCtrl+Ctrl+Q", true)).toContain(
			"operating system",
		);
		expect(validateShortcutBinding("Alt+Tab", false)).toContain(
			"operating system",
		);
		expect(validateShortcutBinding("Ctrl+Alt+Delete", false)).toContain(
			"operating system",
		);
	});

	it("uses platform-specific modifier names", () => {
		expect(validateShortcutBinding("K", true)).toBe(
			"Add a modifier (⌘, ⌥, ⌃) to create a shortcut.",
		);
		expect(validateShortcutBinding("K", false)).toBe(
			"Add a modifier (Ctrl, Alt) to create a shortcut.",
		);
	});
});

describe("shortcutBindingFromEvent", () => {
	it("records punctuation by physical key when Option changes the character", () => {
		// macOS types “ for Option+[.
		const event = new KeyboardEvent("keydown", {
			key: "“",
			code: "BracketLeft",
			metaKey: true,
			altKey: true,
		});

		expect(shortcutBindingFromEvent(event, true)).toBe("CmdOrCtrl+Alt+[");
	});

	it("records the layout's letter, not the key position (Dvorak)", () => {
		// Dvorak types "b" on the key at QWERTY's N, and "x" on QWERTY's B.
		const b = new KeyboardEvent("keydown", {
			key: "b",
			code: "KeyN",
			metaKey: true,
		});
		const x = new KeyboardEvent("keydown", {
			key: "x",
			code: "KeyB",
			metaKey: true,
		});

		expect(shortcutBindingFromEvent(b, true)).toBe("CmdOrCtrl+B");
		expect(shortcutBindingFromEvent(x, true)).toBe("CmdOrCtrl+X");
	});

	it("records a binding that fires from the key that recorded it", () => {
		// Dvorak types "b" on the key at QWERTY's N.
		const event = new KeyboardEvent("keydown", {
			key: "b",
			code: "KeyN",
			ctrlKey: true,
		});
		const binding = shortcutBindingFromEvent(event, false);

		expect(binding).toBe("CmdOrCtrl+B");
		expect(keymatch(event, binding ?? "")).toBe(true);
	});

	it("records the key position while Alt is held", () => {
		const event = new KeyboardEvent("keydown", {
			key: "u",
			code: "KeyF",
			ctrlKey: true,
			altKey: true,
		});

		expect(shortcutBindingFromEvent(event, false)).toBe("CmdOrCtrl+Alt+F");
	});
});
