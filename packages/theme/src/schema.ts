import { z } from "zod/v4";
import {
	COLOR_TOKENS,
	FOUNDATION_COLOR_TOKENS,
	SYNTAX_TOKENS,
	TERMINAL_TOKENS,
} from "./tokens.js";

const paletteNameSchema = z
	.string()
	.min(1)
	.max(80)
	.regex(/^[a-z0-9][a-z0-9._-]*$/i);

export const hexColorSchema = z
	.string()
	.regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i, "Expected #RRGGBB or #RRGGBBAA.");

const colorValueSchema = z
	.string()
	.regex(
		/^(?:#[0-9a-f]{6}(?:[0-9a-f]{2})?|\$[a-z0-9][a-z0-9._-]*)$/i,
		"Expected #RRGGBB, #RRGGBBAA, or a $palette reference.",
	);

export const themeDefinitionSchema = z
	.object({
		$schema: z.string().optional(),
		name: z.string().trim().min(1).max(80),
		author: z.string().trim().min(1).max(120).optional(),
		appearance: z.enum(["light", "dark"]),
		palette: z.record(paletteNameSchema, hexColorSchema).optional(),
		colors: z.partialRecord(z.enum(COLOR_TOKENS), colorValueSchema),
		syntax: z.partialRecord(z.enum(SYNTAX_TOKENS), colorValueSchema).optional(),
		terminal: z
			.partialRecord(z.enum(TERMINAL_TOKENS), colorValueSchema)
			.optional(),
	})
	.strict()
	.superRefine((theme, context) => {
		for (const token of FOUNDATION_COLOR_TOKENS) {
			if (theme.colors[token] === undefined) {
				context.addIssue({
					code: "custom",
					message: `Missing foundation color "${token}".`,
					path: ["colors", token],
				});
			}
		}
	});

export const themeSettingsSchema = z
	.object({
		mode: z.enum(["system", "light", "dark"]),
		light: z.string().min(1),
		dark: z.string().min(1),
	})
	.strict();

const resolvedThemeSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().min(1),
		author: z.string().optional(),
		appearance: z.enum(["light", "dark"]),
		colors: z.record(z.enum(COLOR_TOKENS), hexColorSchema),
		syntax: z.record(z.enum(SYNTAX_TOKENS), hexColorSchema),
		terminal: z.record(z.enum(TERMINAL_TOKENS), hexColorSchema),
	})
	.strict();

export const themeStateSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		settings: themeSettingsSchema,
		systemAppearance: z.enum(["light", "dark"]),
		active: resolvedThemeSchema,
		themes: z.array(resolvedThemeSchema),
		errors: z.array(
			z
				.object({
					file: z.string(),
					message: z.string(),
				})
				.strict(),
		),
	})
	.strict();
