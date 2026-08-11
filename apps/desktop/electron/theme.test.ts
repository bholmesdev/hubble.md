import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadThemeSettings,
	ThemeService,
	themeIdForFilename,
	toElectronColor,
} from "./theme";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

async function createService(): Promise<ThemeService> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-theme-"));
	temporaryDirectories.push(directory);
	const service = new ThemeService(directory, "dark");
	await service.initialize({ watch: false });
	return service;
}

const rosePine = {
	name: "Rosé Pine",
	appearance: "dark",
	colors: {
		background: "#191724",
		foreground: "#e0def4",
		card: "#1f1d2e",
		primary: "#c4a7e7",
		"primary-foreground": "#191724",
		muted: "#26233a",
		"muted-foreground": "#908caa",
		border: "#403d52",
		ring: "#ebbcba",
	},
};

describe("ThemeService", () => {
	it("converts CSS alpha hex colors for Electron", () => {
		expect(toElectronColor("#112233")).toBe("#112233");
		expect(toElectronColor("#11223380")).toBe(
			"rgba(17, 34, 51, 0.5019607843137255)",
		);
	});

	it("uses the normalized filename as identity", () => {
		expect(themeIdForFilename("Rosé Pine.JSON")).toBe("user:rosé pine");
	});

	it("migrates the previous appearance setting", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-theme-"));
		temporaryDirectories.push(directory);
		const settingsPath = path.join(directory, "theme.json");
		await fs.writeFile(settingsPath, JSON.stringify({ source: "dark" }));

		expect(loadThemeSettings(settingsPath)).toEqual({
			mode: "dark",
			light: "builtin:hubble-light",
			dark: "builtin:hubble-dark",
		});
	});

	it("loads valid siblings when another file is malformed", async () => {
		const service = await createService();
		await fs.writeFile(
			path.join(service.themesPath, "rose-pine.json"),
			JSON.stringify(rosePine),
		);
		await fs.writeFile(path.join(service.themesPath, "broken.json"), "{");

		await service.reload();

		expect(service.state.themes.map((theme) => theme.id)).toContain(
			"user:rose-pine",
		);
		expect(service.state.errors).toEqual([
			expect.objectContaining({ file: "broken.json" }),
		]);
	});

	it("falls back without rewriting a missing selection", async () => {
		const service = await createService();
		await service.setSettings({
			mode: "dark",
			light: "builtin:hubble-light",
			dark: "user:missing",
		});

		expect(service.state.settings.dark).toBe("user:missing");
		expect(service.state.active.id).toBe("builtin:hubble-dark");
	});
});
