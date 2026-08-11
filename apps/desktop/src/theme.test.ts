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

let themeListener: ((state: ThemeState) => void) | null = null;
const desktopApi = {
	getThemeState: vi.fn(async () => state),
	setThemeSettings: vi.fn(async () => {}),
	onThemeStateChange: vi.fn((listener: (state: ThemeState) => void) => {
		themeListener = listener;
		return () => {
			if (themeListener === listener) themeListener = null;
		};
	}),
};

vi.mock("./desktopApi", () => ({ desktopApi }));

describe("theme", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		desktopApi.getThemeState.mockResolvedValue(state);
		desktopApi.setThemeSettings.mockResolvedValue(undefined);
		themeListener = null;
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

	it("rolls back an optimistic update when persistence fails", async () => {
		desktopApi.setThemeSettings.mockRejectedValueOnce(
			new Error("write failed"),
		);
		const { initTheme, setThemeSettings, themeStateStore } = await import(
			"./theme"
		);
		await initTheme();

		await expect(
			setThemeSettings({ ...DEFAULT_THEME_SETTINGS, mode: "light" }),
		).rejects.toThrow("write failed");

		expect(themeStateStore.get().settings).toEqual(state.settings);
		expect(document.documentElement.dataset.theme).toBe("builtin:hubble-dark");
	});

	it("ignores stale theme states from Electron", async () => {
		const { initTheme, themeStateStore } = await import("./theme");
		await initTheme();
		const latest: ThemeState = {
			...state,
			revision: 3,
			settings: { ...DEFAULT_THEME_SETTINGS, mode: "light" },
			active: HUBBLE_LIGHT_THEME,
		};
		if (!themeListener) throw new Error("Theme listener was not registered.");

		themeListener(latest);
		themeListener({ ...state, revision: 2 });

		expect(themeStateStore.get()).toEqual(latest);
		expect(document.documentElement.dataset.theme).toBe("builtin:hubble-light");
	});

	it("restores the active theme after a preview", async () => {
		const { initTheme, previewTheme, restoreThemePreview } = await import(
			"./theme"
		);
		await initTheme();

		previewTheme(HUBBLE_LIGHT_THEME);
		expect(document.documentElement.dataset.theme).toBe("builtin:hubble-light");

		restoreThemePreview();
		expect(document.documentElement.dataset.theme).toBe("builtin:hubble-dark");
	});
});
