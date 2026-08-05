export type ThemePreference = "light" | "dark" | "system";

let systemQuery: MediaQueryList | null = null;
let preference: ThemePreference = "system";
let dark = false;
const listeners = new Set<() => void>();

export function isDarkTheme(): boolean {
	return dark;
}

export function subscribeTheme(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function applyTheme(): void {
	const isDark =
		preference === "dark" ||
		(preference === "system" && systemQuery?.matches === true);
	document.documentElement.classList.toggle("dark", isDark);
	if (isDark === dark) return;
	dark = isDark;
	for (const listener of listeners) listener();
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
