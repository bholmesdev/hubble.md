// @vitest-environment happy-dom

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

	it("does not mark reordered registry modifiers as custom", () => {
		expect(isShortcutCustomized("app.toggle-source-mode", {})).toBe(false);
		expect(isShortcutCustomized("app.copy-as-markdown", {})).toBe(false);
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
