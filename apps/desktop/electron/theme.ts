import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type Appearance,
	activeTheme,
	BUILTIN_THEMES,
	DEFAULT_THEME_SETTINGS,
	formatThemeError,
	type HexColor,
	parseThemeDefinition,
	type ResolvedTheme,
	resolveThemeDefinition,
	type ThemeFileError,
	type ThemeSettings,
	type ThemeState,
	themeSettingsSchema,
} from "@hubble.md/theme";
import chokidar, { type FSWatcher } from "chokidar";

export function loadThemeSettings(settingsPath: string): ThemeSettings {
	try {
		const input = JSON.parse(fsSync.readFileSync(settingsPath, "utf8"));
		const parsed = themeSettingsSchema.safeParse(input);
		if (parsed.success) return parsed.data;
		if (
			input?.source === "system" ||
			input?.source === "light" ||
			input?.source === "dark"
		) {
			return { ...DEFAULT_THEME_SETTINGS, mode: input.source };
		}
	} catch {
		// Missing or malformed settings use the built-in defaults.
	}
	return DEFAULT_THEME_SETTINGS;
}

export function themeIdForFilename(filename: string): string {
	return `user:${path.basename(filename, path.extname(filename)).toLowerCase()}`;
}

export function toElectronColor(color: HexColor): string {
	if (color.length === 7) return color;
	const red = Number.parseInt(color.slice(1, 3), 16);
	const green = Number.parseInt(color.slice(3, 5), 16);
	const blue = Number.parseInt(color.slice(5, 7), 16);
	const alpha = Number.parseInt(color.slice(7, 9), 16) / 255;
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export class ThemeService {
	readonly themesPath: string;

	#listeners = new Set<(state: ThemeState) => void>();
	#watcher: FSWatcher | null = null;
	#reloadTimer: ReturnType<typeof setTimeout> | null = null;
	#settingsPath: string;
	#settingsWrite = Promise.resolve();
	#state: ThemeState;

	constructor(userDataPath: string, systemAppearance: Appearance) {
		this.themesPath = path.join(userDataPath, "themes");
		this.#settingsPath = path.join(userDataPath, "theme.json");
		const settings = loadThemeSettings(this.#settingsPath);
		this.#state = {
			revision: 0,
			settings,
			systemAppearance,
			active: activeTheme(settings, BUILTIN_THEMES, systemAppearance),
			themes: BUILTIN_THEMES,
			errors: [],
		};
	}

	get state(): ThemeState {
		return this.#state;
	}

	subscribe(listener: (state: ThemeState) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async initialize(options: { watch?: boolean } = {}): Promise<void> {
		try {
			await fs.mkdir(this.themesPath, { recursive: true });
		} catch (error) {
			this.#publish({
				errors: [{ file: this.themesPath, message: formatThemeError(error) }],
			});
			return;
		}
		await this.reload();
		if (options.watch === false) return;

		this.#watcher = chokidar.watch(this.themesPath, {
			ignoreInitial: true,
			depth: 0,
			awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
		});
		this.#watcher.on("all", (_event, filePath) => {
			if (path.extname(filePath).toLowerCase() !== ".json") return;
			this.#scheduleReload();
		});
		this.#watcher.on("error", (error) => {
			this.#publish({
				errors: [{ file: this.themesPath, message: formatThemeError(error) }],
			});
		});
	}

	async reload(): Promise<void> {
		try {
			const { themes, errors } = await loadCustomThemes(this.themesPath);
			this.#publish({ themes: [...BUILTIN_THEMES, ...themes], errors });
		} catch (error) {
			this.#publish({
				themes: BUILTIN_THEMES,
				errors: [{ file: this.themesPath, message: formatThemeError(error) }],
			});
		}
	}

	async setSettings(input: unknown): Promise<void> {
		const settings = themeSettingsSchema.parse(input);
		const write = async () => {
			await fs.mkdir(path.dirname(this.#settingsPath), { recursive: true });
			const temporaryPath = `${this.#settingsPath}.tmp`;
			await fs.writeFile(
				temporaryPath,
				`${JSON.stringify(settings, null, 2)}\n`,
			);
			await fs.rename(temporaryPath, this.#settingsPath);
		};
		this.#settingsWrite = this.#settingsWrite.then(write, write);
		await this.#settingsWrite;
		this.#publish({ settings });
	}

	setSystemAppearance(systemAppearance: Appearance): void {
		if (this.#state.systemAppearance === systemAppearance) return;
		this.#publish({ systemAppearance });
	}

	async dispose(): Promise<void> {
		if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
		await this.#watcher?.close();
		this.#watcher = null;
	}

	#scheduleReload(): void {
		if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
		this.#reloadTimer = setTimeout(() => {
			this.#reloadTimer = null;
			void this.reload();
		}, 50);
	}

	#publish(
		update: Partial<
			Pick<ThemeState, "settings" | "systemAppearance" | "themes" | "errors">
		>,
	): void {
		const next = { ...this.#state, ...update };
		this.#state = {
			...next,
			revision: next.revision + 1,
			active: activeTheme(next.settings, next.themes, next.systemAppearance),
		};
		for (const listener of this.#listeners) listener(this.#state);
	}
}

async function loadCustomThemes(
	themesPath: string,
): Promise<{ themes: ResolvedTheme[]; errors: ThemeFileError[] }> {
	const entries = await fs.readdir(themesPath, { withFileTypes: true });
	const filenames = entries
		.filter(
			(entry) =>
				entry.isFile() && path.extname(entry.name).toLowerCase() === ".json",
		)
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
	const collisions = findFilenameCollisions(filenames);
	const themes: ResolvedTheme[] = [];
	const errors: ThemeFileError[] = [];

	for (const filename of filenames) {
		if (themeIdForFilename(filename) === "user:") {
			errors.push({
				file: filename,
				message: "Add a name before the .json extension.",
			});
			continue;
		}
		if (collisions.has(filename.toLowerCase())) {
			errors.push({
				file: filename,
				message: "Theme filenames must be unique regardless of letter case.",
			});
			continue;
		}

		try {
			const source = await fs.readFile(path.join(themesPath, filename), "utf8");
			const definition = parseThemeDefinition(JSON.parse(source));
			themes.push(
				resolveThemeDefinition(definition, themeIdForFilename(filename)),
			);
		} catch (error) {
			errors.push({ file: filename, message: formatThemeError(error) });
		}
	}

	themes.sort((left, right) => left.name.localeCompare(right.name));
	return { themes, errors };
}

function findFilenameCollisions(filenames: readonly string[]): Set<string> {
	const counts = new Map<string, number>();
	for (const filename of filenames) {
		const normalized = filename.toLowerCase();
		counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
	}
	return new Set(
		[...counts].filter(([, count]) => count > 1).map(([filename]) => filename),
	);
}
