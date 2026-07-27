import { describe, expect, it } from "vitest";
import {
	appCommandIds,
	commandRegistry,
	editorCommandIds,
	getCommand,
	tiptapBinding,
} from "./commandRegistry";

describe("commandRegistry", () => {
	it("owns unique bindings for every scoped command", () => {
		const bindings = Object.values(commandRegistry).map(
			(command) => command.defaultBinding,
		);
		expect(new Set(bindings).size).toBe(bindings.length);
		expect(appCommandIds).toHaveLength(18);
		expect(editorCommandIds).toHaveLength(15);
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
