export type ThemePreference = "light" | "dark" | "system";

let systemQuery: MediaQueryList | null = null;
let preference: ThemePreference = "system";

function applyTheme(): void {
	document.documentElement.classList.toggle(
		"dark",
		preference === "dark" ||
			(preference === "system" && systemQuery?.matches === true),
	);
}

/**
 * Pass `"system"` only after the Electron main process has dropped any forced
 * `nativeTheme.themeSource`, since Chromium reports that override to
 * `prefers-color-scheme` instead of the real OS appearance.
 */
export function setThemePreference(next: ThemePreference): void {
	preference = next;
	applyTheme();
}

export function initTheme(next: ThemePreference): void {
	// Replace any prior listener so a re-init (HMR) doesn't stack handlers.
	systemQuery?.removeEventListener("change", applyTheme);
	systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
	systemQuery.addEventListener("change", applyTheme);
	setThemePreference(next);
}
