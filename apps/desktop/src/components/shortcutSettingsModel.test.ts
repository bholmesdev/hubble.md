// @vitest-environment happy-dom

import { formatShortcut } from "@hubble.md/ui";
import { describe, expect, it } from "vitest";

Object.defineProperty(window, "desktopApi", { value: {} });

const { filterShortcutGroups, isShortcutCustomized, validateShortcutBinding } =
	await import("./shortcutSettingsModel");

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
