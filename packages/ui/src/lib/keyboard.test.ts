// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { matchShortcut, setQwertyCommandKeys, shortcutKey } from "./keyboard";

afterEach(() => setQwertyCommandKeys(false));

describe("shortcut layout policy", () => {
	it("follows standard Dvorak letters", () => {
		const event = new KeyboardEvent("keydown", {
			key: "b",
			code: "KeyN",
			metaKey: true,
		});
		expect(matchShortcut(event, "Cmd+B")).toBe(true);
		expect(matchShortcut(event, "Cmd+N")).toBe(false);
		expect(shortcutKey(event)).toBe("b");
	});

	it("switches Command matching and recording together without remapping Control", () => {
		const command = new KeyboardEvent("keydown", {
			key: "x",
			code: "KeyB",
			metaKey: true,
		});
		const control = new KeyboardEvent("keydown", {
			key: "x",
			code: "KeyB",
			ctrlKey: true,
		});
		setQwertyCommandKeys(true);
		expect(matchShortcut(command, "Cmd+B")).toBe(true);
		expect(matchShortcut(command, "Cmd+X")).toBe(false);
		expect(shortcutKey(command)).toBe("b");
		expect(matchShortcut(control, "Ctrl+X")).toBe(true);
		expect(shortcutKey(control)).toBe("x");
		setQwertyCommandKeys(false);
		expect(matchShortcut(command, "Cmd+X")).toBe(true);
		expect(shortcutKey(command)).toBe("x");
	});
});
