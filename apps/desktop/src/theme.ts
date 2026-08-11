import {
	activeTheme,
	applyTheme,
	BUILTIN_THEMES,
	DEFAULT_THEME_SETTINGS,
	HUBBLE_LIGHT_THEME,
	type ResolvedTheme,
	type ThemeSettings,
	type ThemeState,
	themeStateSchema,
} from "@hubble.md/theme";
import { store } from "@simplestack/store";
import { desktopApi } from "./desktopApi";

const initialThemeState: ThemeState = {
	revision: 0,
	settings: DEFAULT_THEME_SETTINGS,
	systemAppearance: "light",
	active: HUBBLE_LIGHT_THEME,
	themes: BUILTIN_THEMES,
	errors: [],
};

export const themeStateStore = store<ThemeState>(initialThemeState);

let unsubscribe: (() => void) | null = null;
let settingsRequest = 0;

function acceptThemeState(input: unknown): void {
	const state = themeStateSchema.parse(input) as ThemeState;
	if (state.revision < themeStateStore.get().revision) return;
	themeStateStore.set(state);
	applyTheme(document.documentElement, state.active);
}

export async function initTheme(): Promise<void> {
	unsubscribe?.();
	unsubscribe = desktopApi.onThemeStateChange(acceptThemeState);
	try {
		acceptThemeState(await desktopApi.getThemeState());
	} catch (error) {
		// Don't apply the default theme while waiting: the bare document already
		// shows the window's native background, and painting light-first would
		// flash on reload in a dark window. Style the page only if the real state
		// never arrives.
		applyTheme(document.documentElement, themeStateStore.get().active);
		throw error;
	}
}

export async function setThemeSettings(settings: ThemeSettings): Promise<void> {
	const request = ++settingsRequest;
	const previous = themeStateStore.get();
	const next = {
		...previous,
		settings,
		active: activeTheme(settings, previous.themes, previous.systemAppearance),
	};
	themeStateStore.set(next);
	applyTheme(document.documentElement, next.active);

	try {
		await desktopApi.setThemeSettings(settings);
	} catch (error) {
		if (request === settingsRequest) {
			const current = themeStateStore.get();
			const rollback = {
				...current,
				settings: previous.settings,
				active: activeTheme(
					previous.settings,
					current.themes,
					current.systemAppearance,
				),
			};
			themeStateStore.set(rollback);
			applyTheme(document.documentElement, rollback.active);
		}
		throw error;
	}
}

export function previewTheme(theme: ResolvedTheme): void {
	applyTheme(document.documentElement, theme);
}

export function restoreThemePreview(): void {
	applyTheme(document.documentElement, themeStateStore.get().active);
}
