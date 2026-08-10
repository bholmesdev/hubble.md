import { Select } from "@base-ui/react/select";
import { Button, Switch } from "@hubble.md/ui";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteDownLine from "~icons/mingcute/down-line";
import { desktopApi } from "../desktopApi";
import type { SpellcheckState } from "../desktopApi/types";
import { languageName, sortLanguages } from "../lib/spellcheckLanguages";
import { SettingsSection } from "./SettingsDialog";

export function SpellcheckSettingsSection({
	state,
	onEnabledChange,
	onLanguagesChange,
}: {
	state: SpellcheckState;
	onEnabledChange: (enabled: boolean) => void;
	onLanguagesChange: (languages: string[]) => void;
}) {
	return (
		<SettingsSection
			title="Spellcheck"
			description="Underline misspelled words as you type."
			action={
				<Switch
					aria-label="Check spelling"
					checked={state.enabled}
					onCheckedChange={onEnabledChange}
				/>
			}
		>
			{desktopApi.platform === "darwin" ? (
				<p className="text-xs text-muted-foreground">
					macOS detects the language you are writing in automatically.
				</p>
			) : (
				<LanguagePicker state={state} onLanguagesChange={onLanguagesChange} />
			)}
		</SettingsSection>
	);
}

function LanguagePicker({
	state,
	onLanguagesChange,
}: {
	state: SpellcheckState;
	onLanguagesChange: (languages: string[]) => void;
}) {
	return (
		<Select.Root
			multiple
			value={state.languages}
			onValueChange={(next) => {
				// Chromium needs at least one language, and silently falls back to
				// en-US on an empty list, so keep the last one checked.
				if (next.length === 0) return;
				onLanguagesChange(next);
			}}
		>
			<Select.Trigger
				render={
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={!state.enabled}
						aria-label="Spellcheck languages"
						className="w-full justify-between"
					/>
				}
			>
				<Select.Value className="truncate">
					{state.languages.map(languageName).join(", ") || "Choose a language"}
				</Select.Value>
				<Select.Icon className="text-muted-foreground">
					<MingcuteDownLine className="size-3.5" />
				</Select.Icon>
			</Select.Trigger>
			<Select.Portal>
				<Select.Positioner
					align="start"
					side="bottom"
					sideOffset={8}
					// Otherwise the popup grows to align the checked item with the
					// trigger and spills out of the settings dialog.
					alignItemWithTrigger={false}
					className="isolate z-50"
				>
					<Select.Popup className="z-50 max-h-72 w-64 origin-(--transform-origin) overflow-y-auto rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						{sortLanguages(state.availableLanguages).map((code) => (
							<Select.Item
								key={code}
								value={code}
								className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-start text-[11px] text-foreground outline-hidden select-none data-highlighted:bg-accent"
							>
								<Select.ItemIndicator className="inline-flex" keepMounted>
									<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
								</Select.ItemIndicator>
								<Select.ItemText>{languageName(code)}</Select.ItemText>
							</Select.Item>
						))}
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}
