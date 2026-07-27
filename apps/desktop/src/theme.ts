export type ThemePreference = "light" | "dark" | "system";

let systemPrefersDark = false;
let themePreference: ThemePreference = "system";

function applyTheme(): void {
	document.documentElement.classList.toggle(
		"dark",
		themePreference === "dark" ||
			(themePreference === "system" && systemPrefersDark),
	);
}

export function setThemePreference(preference: ThemePreference): void {
	themePreference = preference;
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
	systemPrefersDark = query.matches;
	setThemePreference(preference);
}
