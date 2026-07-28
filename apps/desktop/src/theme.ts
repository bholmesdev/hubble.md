export type ThemePreference = "light" | "dark" | "system";

let systemQuery: MediaQueryList | null = null;
let systemPrefersDark = false;
let themePreference: ThemePreference = "system";

function applyTheme(): void {
	document.documentElement.classList.toggle(
		"dark",
		themePreference === "dark" ||
			(themePreference === "system" && systemPrefersDark),
	);
}

/**
 * Applies a preference to the `dark` class on `<html>`.
 *
 * Callers must only pass `"system"` once main has released
 * `nativeTheme.themeSource`, because Electron reports a forced override through
 * `prefers-color-scheme` while one is active.
 */
export function setThemePreference(preference: ThemePreference): void {
	themePreference = preference;
	// Re-read instead of trusting the cache: it holds whatever the override was
	// reporting, and a missed change event would leave it pinned there.
	if (preference === "system" && systemQuery) {
		systemPrefersDark = systemQuery.matches;
	}
	applyTheme();
}

let detachSystemListener: (() => void) | null = null;

export function initTheme(preference: ThemePreference): void {
	// Replace any prior listener so a re-init (HMR) doesn't stack handlers.
	detachSystemListener?.();
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	const onChange = (event: MediaQueryListEvent) => {
		systemPrefersDark = event.matches;
		applyTheme();
	};
	query.addEventListener("change", onChange);
	detachSystemListener = () => query.removeEventListener("change", onChange);
	systemQuery = query;
	systemPrefersDark = query.matches;
	setThemePreference(preference);
}
