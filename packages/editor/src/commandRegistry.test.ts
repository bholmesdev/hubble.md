import { describe, expect, it } from "vitest";
import {
	commandRegistry,
	getCommand,
	tiptapBinding,
} from "./commandRegistry.js";

describe("commandRegistry", () => {
	it("owns unique bindings for every command", () => {
		const bindings = Object.values(commandRegistry).map(
			(command) => command.defaultBinding,
		);
		expect(new Set(bindings).size).toBe(bindings.length);
	});

	it("maps open folder and recent shortcuts", () => {
		expect(getCommand("app.open-folder")).toMatchObject({
			defaultBinding: "CmdOrCtrl+Shift+O",
			label: "Open Folder...",
		});
		expect(getCommand("app.open-recent")).toMatchObject({
			defaultBinding: "Ctrl+R",
			label: "Open Recent",
		});
	});

	it("resolves context-dependent enablement", () => {
		expect(getCommand("app.go-back").isEnabled({ canGoBack: false })).toBe(
			false,
		);
		expect(getCommand("app.go-back").isEnabled({ canGoBack: true })).toBe(true);
		expect(
			getCommand("app.chat-about-note").isEnabled({
				hasEditableFile: true,
				hasWorkspace: false,
			}),
		).toBe(false);
		expect(
			getCommand("app.chat-about-note").isEnabled({
				hasEditableFile: true,
				hasWorkspace: true,
			}),
		).toBe(true);
	});

	it("converts shared bindings to TipTap syntax", () => {
		expect(tiptapBinding("editor.heading-1")).toBe("Mod-Alt-1");
		expect(tiptapBinding("editor.strike")).toBe("Mod-Shift-x");
	});
});
