// @vitest-environment happy-dom
import {
	DEFAULT_THEME_SETTINGS,
	HUBBLE_DARK_THEME,
	HUBBLE_LIGHT_THEME,
	type ThemeState,
} from "@hubble.md/theme";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: ThemeState = {
	revision: 1,
	settings: { ...DEFAULT_THEME_SETTINGS, mode: "dark" },
	systemAppearance: "light",
	active: HUBBLE_DARK_THEME,
	themes: [HUBBLE_LIGHT_THEME, HUBBLE_DARK_THEME],
	errors: [],
};

const desktopApi = {
	getThemeState: vi.fn(async () => state),
	setThemeSettings: vi.fn(async () => {}),
	onThemeStateChange: vi.fn(() => () => {}),
};

vi.mock("./desktopApi", () => ({ desktopApi }));

describe("theme", () => {
	beforeEach(() => {
		document.documentElement.removeAttribute("class");
		document.documentElement.removeAttribute("style");
		document.documentElement.removeAttribute("data-theme");
		document.documentElement.removeAttribute("data-appearance");
	});

	it("applies the initial theme state from Electron", async () => {
		const { initTheme, themeStateStore } = await import("./theme");
		await initTheme();

		expect(themeStateStore.get()).toEqual(state);
		expect(document.documentElement.dataset.theme).toBe("builtin:hubble-dark");
		expect(
			document.documentElement.style.getPropertyValue("--background"),
		).toBe("#171614");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("updates immediately and persists the full selection", async () => {
		const { initTheme, setThemeSettings } = await import("./theme");
		await initTheme();
		const settings = { ...DEFAULT_THEME_SETTINGS, mode: "light" as const };

		await setThemeSettings(settings);

		expect(desktopApi.setThemeSettings).toHaveBeenCalledWith(settings);
		expect(document.documentElement.dataset.theme).toBe("builtin:hubble-light");
	});
});
