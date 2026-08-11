import type {
	ColorToken,
	FoundationColorToken,
	SyntaxToken,
	TerminalToken,
} from "./tokens.js";

export type Appearance = "light" | "dark";
export type HexColor = `#${string}`;
export type ThemeColor = HexColor | `$${string}`;

export interface ThemeDefinition {
	$schema?: string;
	name: string;
	author?: string;
	appearance: Appearance;
	palette?: Record<string, HexColor>;
	colors: Partial<Record<ColorToken, ThemeColor>> &
		Record<FoundationColorToken, ThemeColor>;
	syntax?: Partial<Record<SyntaxToken, ThemeColor>>;
	terminal?: Partial<Record<TerminalToken, ThemeColor>>;
}

export interface ResolvedTheme {
	id: string;
	name: string;
	author?: string;
	appearance: Appearance;
	colors: Record<ColorToken, HexColor>;
	syntax: Record<SyntaxToken, HexColor>;
	terminal: Record<TerminalToken, HexColor>;
}

export interface ThemeSettings {
	mode: Appearance | "system";
	light: string;
	dark: string;
}

export interface ThemeFileError {
	file: string;
	message: string;
}

export interface ThemeState {
	revision: number;
	settings: ThemeSettings;
	systemAppearance: Appearance;
	active: ResolvedTheme;
	themes: ResolvedTheme[];
	errors: ThemeFileError[];
}
