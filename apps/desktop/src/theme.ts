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

export function initTheme(preference: ThemePreference): void {
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	systemPrefersDark = query.matches;
	setThemePreference(preference);
	query.addEventListener("change", (event) => {
		systemPrefersDark = event.matches;
		applyTheme();
	});
}
