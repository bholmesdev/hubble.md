import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CommandDefinition,
	cleanCommandBindings,
	commandRegistry,
	findCommandBindingConflicts,
	getCommand,
	getCommandBinding,
	getCommandBindings,
	isDefaultCommandBinding,
	resolveCommandBinding,
	setCommandBindings,
	subscribeCommandBindings,
	tiptapBinding,
} from "./commandRegistry.js";

afterEach(() => setCommandBindings({}));

describe("commandRegistry", () => {
	it("allows duplicate defaults only for mutually paired commands", () => {
		const commands: Record<string, CommandDefinition> = commandRegistry;
		const bindings = new Map<string, string>();
		for (const [id, command] of Object.entries(commands)) {
			if (command.allowConflictWith) {
				expect(commands[command.allowConflictWith]?.allowConflictWith).toBe(id);
			}
			const earlierId = bindings.get(command.defaultBinding);
			if (earlierId) {
				expect(command.allowConflictWith).toBe(earlierId);
				expect(commands[earlierId]?.allowConflictWith).toBe(id);
			}
			bindings.set(command.defaultBinding, id);
		}
		expect(getCommandBinding("app.go-to-file")).toBe("CmdOrCtrl+K");
		expect(getCommandBinding("editor.link")).toBe("CmdOrCtrl+K");
		expect(findCommandBindingConflicts("editor.link", {})).toEqual([
			"app.go-to-file",
		]);
	});

	it("keeps paired commands active when both are remapped", () => {
		setCommandBindings({
			"app.go-to-file": "CmdOrCtrl+Alt+K",
			"editor.link": "CmdOrCtrl+Alt+K",
		});
		expect(getCommandBinding("app.go-to-file")).toBe("CmdOrCtrl+Alt+K");
		expect(getCommandBinding("editor.link")).toBe("CmdOrCtrl+Alt+K");
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

	it("resolves custom and disabled bindings", () => {
		setCommandBindings({
			"app.new-file": "CmdOrCtrl+Alt+N",
			"editor.bold": null,
		});

		expect(getCommandBinding("app.new-file")).toBe("CmdOrCtrl+Alt+N");
		expect(getCommandBinding("editor.bold")).toBeNull();
		expect(getCommandBinding("app.settings")).toBe("CmdOrCtrl+,");
		expect(tiptapBinding("editor.bold")).toBeNull();
	});

	it("keeps conflicting bindings but activates the first command", () => {
		setCommandBindings({ "app.settings": "CmdOrCtrl+N" });

		expect(resolveCommandBinding("app.settings", getCommandBindings())).toBe(
			"CmdOrCtrl+N",
		);
		expect(
			findCommandBindingConflicts("app.settings", getCommandBindings()),
		).toEqual(["app.new-file"]);
		expect(getCommandBinding("app.new-file")).toBe("CmdOrCtrl+N");
		expect(getCommandBinding("app.settings")).toBeNull();
	});

	it("drops unknown, invalid, and default persisted values", () => {
		expect(
			cleanCommandBindings({
				"app.new-file": "CmdOrCtrl+N",
				"app.toggle-source-mode": "CmdOrCtrl+Alt+U",
				"app.settings": null,
				"editor.bold": 42,
				"missing.command": "CmdOrCtrl+M",
			}),
		).toEqual({ "app.settings": null });
		expect(
			isDefaultCommandBinding("app.toggle-source-mode", "CmdOrCtrl+Alt+U"),
		).toBe(true);
		expect(
			resolveCommandBinding("app.settings", { "app.settings": null }),
		).toBeNull();
	});

	it("notifies binding subscribers", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeCommandBindings(listener);

		setCommandBindings({ "app.settings": null });
		expect(listener).toHaveBeenCalledOnce();

		unsubscribe();
		setCommandBindings({});
		expect(listener).toHaveBeenCalledOnce();
	});
});
