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
 * Pass `"system"` only once main has released `nativeTheme.themeSource`, since
 * Electron reports a forced override through `prefers-color-scheme`.
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
