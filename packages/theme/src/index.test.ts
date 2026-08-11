import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	activeTheme,
	COLOR_TOKENS,
	DEFAULT_THEME_SETTINGS,
	FOUNDATION_COLOR_TOKENS,
	HUBBLE_DARK_THEME,
	HUBBLE_LIGHT_THEME,
	parseThemeDefinition,
	resolveThemeDefinition,
	SYNTAX_TOKENS,
	TERMINAL_TOKENS,
	themeCss,
	themeVariables,
} from "./index.js";

const sharedThemeCss = readFileSync(
	new URL("../../ui/src/theme.css", import.meta.url),
	"utf8",
);

function cssVariables(selector: string): Record<string, string> {
	const start = sharedThemeCss.indexOf(`${selector} {`);
	if (start === -1) throw new Error(`Missing ${selector} theme fallback.`);
	const end = sharedThemeCss.indexOf("}", start);
	const block = sharedThemeCss.slice(start, end);
	return Object.fromEntries(
		[...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
			match[1],
			match[2].trim(),
		]),
	);
}

const customTheme = {
	name: "Rosé Pine",
	appearance: "dark",
	palette: {
		base: "#191724",
		text: "#e0def4",
	},
	colors: {
		background: "$base",
		foreground: "$text",
		card: "#1f1d2e",
		primary: "#c4a7e7",
		"primary-foreground": "$base",
		muted: "#26233a",
		"muted-foreground": "#908caa",
		border: "#403d52",
		ring: "#ebbcba",
	},
} as const;

describe("custom themes", () => {
	it("requires the foundation colors", () => {
		expect(() =>
			parseThemeDefinition({
				...customTheme,
				colors: { background: "#191724" },
			}),
		).toThrow(/foundation color/);
	});

	it("resolves palette references and derived colors", () => {
		const theme = resolveThemeDefinition(
			parseThemeDefinition(customTheme),
			"user:rose-pine",
		);

		expect(theme.colors.background).toBe("#191724");
		expect(theme.colors["card-foreground"]).toBe("#e0def4");
		expect(theme.colors.selected).toBe("#c4a7e7");
		expect(theme.terminal.background).toBe("#191724");
		expect(theme.syntax.keyword).toBe(HUBBLE_DARK_THEME.syntax.keyword);
	});

	it("rejects inherited palette references", () => {
		expect(() =>
			resolveThemeDefinition(
				parseThemeDefinition({
					...customTheme,
					colors: { ...customTheme.colors, background: "$toString" },
				}),
				"user:prototype-reference",
			),
		).toThrow('Unknown palette color "$toString".');
	});

	it("falls back when a selected theme is unavailable", () => {
		expect(
			activeTheme(DEFAULT_THEME_SETTINGS, [HUBBLE_LIGHT_THEME], "dark"),
		).toBe(HUBBLE_DARK_THEME);
	});

	it("serializes resolved variables only", () => {
		const css = themeCss(HUBBLE_LIGHT_THEME);
		expect(css).toContain("--background:#fefdfd");
		expect(css).toContain("--syntax-keyword:#aa0d91");
		expect(css).not.toContain("undefined");
	});

	it("keeps the shared CSS fallbacks aligned with the built-in themes", () => {
		for (const [selector, theme] of [
			[":root", HUBBLE_LIGHT_THEME],
			[".dark", HUBBLE_DARK_THEME],
		] as const) {
			const variables = cssVariables(selector);
			const expected = themeVariables(theme);
			expect(
				Object.fromEntries(
					Object.keys(expected).map((property) => [
						property,
						variables[property],
					]),
				),
			).toEqual(expected);
		}
	});

	it("documents every token in its JSON schema", () => {
		const schema = JSON.parse(
			readFileSync(new URL("../theme.schema.json", import.meta.url), "utf8"),
		);
		const properties = (name: string) =>
			Object.keys(schema.$defs[name].properties);

		expect(properties("colorMap")).toEqual([...COLOR_TOKENS]);
		expect(properties("syntaxMap")).toEqual([...SYNTAX_TOKENS]);
		expect(properties("terminalMap")).toEqual([...TERMINAL_TOKENS]);
		expect(schema.properties.colors.required).toEqual([
			...FOUNDATION_COLOR_TOKENS,
		]);
	});
});
