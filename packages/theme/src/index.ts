import { z } from "zod/v4";
import {
	BUILTIN_THEMES,
	HUBBLE_DARK_THEME,
	HUBBLE_LIGHT_THEME,
} from "./builtins.js";
import {
	hexColorSchema,
	themeDefinitionSchema,
	themeSettingsSchema,
	themeStateSchema,
} from "./schema.js";
import {
	COLOR_TOKENS,
	FOUNDATION_COLOR_TOKENS,
	SYNTAX_TOKENS,
	TERMINAL_TOKENS,
} from "./tokens.js";
import type {
	Appearance,
	HexColor,
	ResolvedTheme,
	ThemeColor,
	ThemeDefinition,
	ThemeFileError,
	ThemeSettings,
	ThemeState,
} from "./types.js";

export {
	BUILTIN_THEMES,
	COLOR_TOKENS,
	FOUNDATION_COLOR_TOKENS,
	HUBBLE_DARK_THEME,
	HUBBLE_LIGHT_THEME,
	SYNTAX_TOKENS,
	TERMINAL_TOKENS,
	hexColorSchema,
	themeDefinitionSchema,
	themeSettingsSchema,
	themeStateSchema,
};
export type {
	Appearance,
	HexColor,
	ResolvedTheme,
	ThemeColor,
	ThemeDefinition,
	ThemeFileError,
	ThemeSettings,
	ThemeState,
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
	mode: "system",
	light: HUBBLE_LIGHT_THEME.id,
	dark: HUBBLE_DARK_THEME.id,
};

function resolveColor(
	value: ThemeColor | undefined,
	palette: Record<string, HexColor>,
	fallback: HexColor,
): HexColor {
	if (!value) return fallback;
	if (value.startsWith("#")) return value as HexColor;

	const name = value.slice(1);
	const resolved = Object.getOwnPropertyDescriptor(palette, name)?.value;
	if (typeof resolved !== "string") {
		throw new Error(`Unknown palette color "${value}".`);
	}
	return resolved as HexColor;
}

function resolveMap<K extends string>(
	keys: readonly K[],
	input: Partial<Record<K, ThemeColor>> | undefined,
	palette: Record<string, HexColor>,
	fallback: Record<K, HexColor>,
): Record<K, HexColor> {
	return Object.fromEntries(
		keys.map((key) => [
			key,
			resolveColor(input?.[key], palette, fallback[key]),
		]),
	) as Record<K, HexColor>;
}

export function parseThemeDefinition(input: unknown): ThemeDefinition {
	return themeDefinitionSchema.parse(input) as ThemeDefinition;
}

export function resolveThemeDefinition(
	definition: ThemeDefinition,
	id: string,
): ResolvedTheme {
	const fallback =
		definition.appearance === "dark" ? HUBBLE_DARK_THEME : HUBBLE_LIGHT_THEME;
	const palette = definition.palette ?? {};
	const foundation = resolveMap(
		FOUNDATION_COLOR_TOKENS,
		definition.colors,
		palette,
		fallback.colors,
	);
	const colors = resolveMap(COLOR_TOKENS, definition.colors, palette, {
		...fallback.colors,
		brand: foundation.primary,
		"brand-accent": foundation.ring,
		"brand-accent-foreground": foundation["primary-foreground"],
		"card-foreground": foundation.foreground,
		popover: foundation.card,
		"popover-foreground": foundation.foreground,
		secondary: foundation.muted,
		"secondary-foreground": foundation.foreground,
		accent: foundation.muted,
		"accent-foreground": foundation.foreground,
		selected: foundation.primary,
		"selected-foreground": foundation["primary-foreground"],
		input: foundation.border,
		sidebar: foundation.card,
		"sidebar-foreground": foundation.foreground,
		"sidebar-accent": foundation.muted,
		"sidebar-accent-foreground": foundation.foreground,
		"sidebar-border": foundation.border,
	});

	return {
		id,
		name: definition.name,
		...(definition.author ? { author: definition.author } : {}),
		appearance: definition.appearance,
		colors,
		syntax: resolveMap(
			SYNTAX_TOKENS,
			definition.syntax,
			palette,
			fallback.syntax,
		),
		terminal: resolveMap(TERMINAL_TOKENS, definition.terminal, palette, {
			...fallback.terminal,
			foreground: colors.foreground,
			background: colors.background,
			cursor: colors.foreground,
			"cursor-accent": colors.background,
			"selection-background": colors.selected,
			"selection-foreground": colors["selected-foreground"],
		}),
	};
}

export function findTheme(
	themes: readonly ResolvedTheme[],
	id: string,
	appearance: Appearance,
): ResolvedTheme {
	return (
		themes.find(
			(theme) => theme.id === id && theme.appearance === appearance,
		) ?? (appearance === "dark" ? HUBBLE_DARK_THEME : HUBBLE_LIGHT_THEME)
	);
}

export function activeTheme(
	settings: ThemeSettings,
	themes: readonly ResolvedTheme[],
	systemAppearance: Appearance,
): ResolvedTheme {
	const appearance =
		settings.mode === "system" ? systemAppearance : settings.mode;
	return findTheme(themes, settings[appearance], appearance);
}

export function themeVariables(theme: ResolvedTheme): Record<string, HexColor> {
	return Object.fromEntries([
		...COLOR_TOKENS.map((token) => [`--${token}`, theme.colors[token]]),
		...SYNTAX_TOKENS.map((token) => [`--syntax-${token}`, theme.syntax[token]]),
	]);
}

export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
	for (const [property, value] of Object.entries(themeVariables(theme))) {
		root.style.setProperty(property, value);
	}
	root.dataset.theme = theme.id;
	root.dataset.appearance = theme.appearance;
	root.classList.toggle("dark", theme.appearance === "dark");
	root.style.colorScheme = theme.appearance;
}

export function themeCss(theme: ResolvedTheme, selector = ":root"): string {
	const declarations = Object.entries(themeVariables(theme))
		.map(([property, value]) => `${property}:${value}`)
		.join(";");
	return `${selector}{${declarations};color-scheme:${theme.appearance}}`;
}

export function formatThemeError(error: unknown): string {
	if (!(error instanceof z.ZodError)) {
		return error instanceof Error ? error.message : String(error);
	}
	return error.issues
		.map((issue) => {
			const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
			return `${path}${issue.message}`;
		})
		.join("; ");
}
