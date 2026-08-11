import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Select } from "@base-ui/react/select";
import {
	type Appearance,
	findTheme,
	type ResolvedTheme,
	type ThemeSettings,
} from "@hubble.md/theme";
import { Button } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { useEffect } from "react";
import { toast } from "sonner";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteDownLine from "~icons/mingcute/down-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import { desktopApi } from "../desktopApi";
import {
	previewTheme,
	restoreThemePreview,
	setThemeSettings,
	themeStateStore,
} from "../theme";
import { SettingsSection } from "./SettingsDialog";

export function AppearanceSettingsSection() {
	const state = useStoreValue(themeStateStore);
	useEffect(() => () => restoreThemePreview(), []);
	const appearance =
		state.settings.mode === "system"
			? state.systemAppearance
			: state.settings.mode;

	const updateSettings = (settings: ThemeSettings) => {
		void setThemeSettings(settings).catch((error) => {
			toast.error("Could not save theme", { description: errorMessage(error) });
		});
	};

	return (
		<SettingsSection title="Appearance">
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-1.5 text-[11px] font-medium text-muted-foreground">
					<span id="appearance-mode-label">Mode</span>
					<ModePicker
						value={state.settings.mode}
						lightTheme={findTheme(state.themes, state.settings.light, "light")}
						darkTheme={findTheme(state.themes, state.settings.dark, "dark")}
						onChange={(mode) => updateSettings({ ...state.settings, mode })}
					/>
				</div>
				<ThemeSelect
					appearance={appearance}
					themes={state.themes}
					value={state.settings[appearance]}
					onChange={(id) =>
						updateSettings({ ...state.settings, [appearance]: id })
					}
				/>
				{state.errors.length > 0 ? (
					<output className="block rounded-sm border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-[11px] text-destructive">
						{state.errors.map((error) => (
							<p key={error.file}>
								<span className="font-medium">{error.file}:</span>{" "}
								{error.message}
							</p>
						))}
					</output>
				) : null}
			</div>
		</SettingsSection>
	);
}

const modes = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
] as const;

function ModePicker({
	value,
	lightTheme,
	darkTheme,
	onChange,
}: {
	value: ThemeSettings["mode"];
	lightTheme: ResolvedTheme;
	darkTheme: ResolvedTheme;
	onChange: (mode: ThemeSettings["mode"]) => void;
}) {
	return (
		<RadioGroup
			aria-labelledby="appearance-mode-label"
			value={value}
			onValueChange={(mode) => onChange(mode as ThemeSettings["mode"])}
			className="grid w-full grid-cols-3 gap-2"
		>
			{modes.map((option) => (
				<Radio.Root
					key={option.value}
					value={option.value}
					className="group flex min-w-0 cursor-pointer flex-col gap-1.5 text-[11px] font-medium text-muted-foreground outline-hidden"
				>
					<span
						aria-hidden
						className="h-12 w-full overflow-hidden rounded-md border border-border transition-[border-color,box-shadow] ease-snappy group-hover:border-foreground/25 group-data-checked:border-ring group-data-checked:ring-1 group-data-checked:ring-ring/30 group-focus-visible:border-ring group-focus-visible:ring-2 group-focus-visible:ring-ring/50 group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-background"
					>
						{option.value === "light" ? (
							<ThemePreview theme={lightTheme} />
						) : option.value === "dark" ? (
							<ThemePreview theme={darkTheme} />
						) : (
							<span className="relative block h-full">
								<ThemePreview theme={lightTheme} />
								<span
									className="absolute inset-0"
									style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
								>
									<ThemePreview theme={darkTheme} />
								</span>
								<span
									className="pointer-events-none absolute inset-0"
									style={{
										background: `linear-gradient(to bottom right, transparent calc(50% - 0.5px), ${lightTheme.colors.border} 50%, transparent calc(50% + 0.5px))`,
									}}
								/>
							</span>
						)}
					</span>
					<span className="text-center transition-colors group-data-checked:text-foreground">
						{option.label}
					</span>
				</Radio.Root>
			))}
		</RadioGroup>
	);
}

function ThemePreview({ theme }: { theme: ResolvedTheme }) {
	const { colors } = theme;
	return (
		<span
			className="flex h-full w-full"
			style={{ backgroundColor: colors.background }}
		>
			<span
				className="flex w-[30%] flex-col gap-1 border-r p-2"
				style={{ backgroundColor: colors.sidebar, borderColor: colors.border }}
			>
				<span
					className="h-1 w-5/6 rounded-full"
					style={{ backgroundColor: colors.selected }}
				/>
				<span
					className="h-1 w-3/5 rounded-full opacity-50"
					style={{ backgroundColor: colors["muted-foreground"] }}
				/>
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1 p-2">
				<span
					className="h-1 w-1/2 rounded-full"
					style={{ backgroundColor: colors.foreground }}
				/>
				<span
					className="h-1 w-full rounded-full opacity-60"
					style={{ backgroundColor: colors["muted-foreground"] }}
				/>
				<span
					className="mt-auto h-1.5 w-2/5 rounded-full"
					style={{ backgroundColor: colors.primary }}
				/>
			</span>
		</span>
	);
}

function ThemeSelect({
	appearance,
	themes,
	value,
	onChange,
}: {
	appearance: Appearance;
	themes: ResolvedTheme[];
	value: string;
	onChange: (value: string) => void;
}) {
	const options = themes.filter((theme) => theme.appearance === appearance);
	const selected = findTheme(themes, value, appearance);

	return (
		<div className="flex min-w-0 flex-col gap-1.5 text-[11px] font-medium text-muted-foreground">
			<span id="appearance-theme-label">Theme</span>
			<div className="flex min-w-0 gap-1.5">
				<Select.Root
					value={selected.id}
					onValueChange={(next) => next && onChange(next)}
					onOpenChange={(open) => {
						if (!open) restoreThemePreview();
					}}
				>
					<Select.Trigger
						aria-labelledby="appearance-theme-label"
						render={
							<Button
								variant="outline"
								className="min-w-0 flex-1 justify-between"
							/>
						}
					>
						<span className="flex min-w-0 items-center gap-2">
							<ThemeSwatches theme={selected} />
							<span className="truncate">{selected.name}</span>
						</span>
						<MingcuteDownLine className="size-3 text-muted-foreground" />
					</Select.Trigger>
					<Select.Portal>
						<Select.Positioner
							align="start"
							alignItemWithTrigger={false}
							side="bottom"
							sideOffset={4}
							className="isolate z-50"
						>
							<Select.Popup
								className="w-(--anchor-width) origin-(--transform-origin) rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden"
								onKeyUp={(event) => {
									// Base UI's Select exposes no highlight callback, so keyboard
									// navigation reads the highlighted item back off the DOM.
									const id = event.currentTarget
										.querySelector<HTMLElement>("[data-highlighted]")
										?.getAttribute("data-theme-id");
									const theme = options.find((option) => option.id === id);
									if (theme) previewTheme(theme);
								}}
							>
								{options.map((theme) => (
									<Select.Item
										key={theme.id}
										value={theme.id}
										data-theme-id={theme.id}
										className="flex h-7 cursor-pointer items-center gap-2 rounded-sm px-2 outline-hidden data-highlighted:bg-accent"
										onMouseEnter={() => previewTheme(theme)}
									>
										<Select.ItemIndicator
											className="inline-flex w-3"
											keepMounted
										>
											<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
										</Select.ItemIndicator>
										<ThemeSwatches theme={theme} />
										<span className="min-w-0 flex-1 truncate">
											<Select.ItemText>{theme.name}</Select.ItemText>
										</span>
									</Select.Item>
								))}
							</Select.Popup>
						</Select.Positioner>
					</Select.Portal>
				</Select.Root>
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label="Open themes folder"
					title="Open themes folder"
					onClick={() => void openThemesFolder()}
				>
					<MingcuteFolderOpenLine />
				</Button>
			</div>
		</div>
	);
}

function ThemeSwatches({ theme }: { theme: ResolvedTheme }) {
	return (
		<Swatches
			colors={[
				theme.colors.background,
				theme.colors.primary,
				theme.colors.foreground,
			]}
		/>
	);
}

function Swatches({ colors }: { colors: readonly string[] }) {
	return (
		<span className="flex shrink-0 overflow-hidden rounded-full border border-border">
			{colors.map((color, index) => (
				<span
					key={`${index}:${color}`}
					className="size-2.5"
					style={{ backgroundColor: color }}
				/>
			))}
		</span>
	);
}

async function openThemesFolder(): Promise<void> {
	try {
		await desktopApi.openThemesFolder();
	} catch (error) {
		toast.error("Could not open themes folder", {
			description: errorMessage(error),
		});
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
