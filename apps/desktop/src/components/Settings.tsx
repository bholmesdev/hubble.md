import {
	type CommandId,
	findCommandBindingConflicts,
	getCommand,
	resolveCommandBinding,
} from "@hubble.md/editor";
import { Button, formatShortcut, Input } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcutePencilLine from "~icons/mingcute/pencil-line";
import MingcuteRefresh2Line from "~icons/mingcute/refresh-2-line";
import type { DesktopUpdateState } from "../desktopApi/types";
import {
	resetShortcutBindings,
	setChatCommand,
	setCodeFileOpenMode,
	setShortcutBinding,
	setSpellcheckEnabled,
	setSpellcheckLanguages,
	setTelemetryConsent,
	setThemePreference,
} from "../store/actions";
import {
	chatCommandStore,
	codeFileOpenModeStore,
	shortcutBindingsStore,
	spellcheckStore,
	telemetryConsentStore,
	themePreferenceStore,
} from "../store/state";
import { SettingsDialog, SettingsSection } from "./SettingsDialog";
import { SpellcheckSettingsSection } from "./SpellcheckSection";
import {
	filterShortcutGroups,
	isShortcutCustomized,
	type ShortcutCommand,
	shortcutBindingFromEvent,
	validateShortcutBinding,
} from "./shortcutSettingsModel";
import { TelemetrySettingsSection } from "./TelemetrySection";
import { UpdatesSection } from "./UpdatesSection";

type SettingsPage = "general" | "chat" | "shortcuts";
type Errors = Partial<Record<CommandId, string>>;

export function Settings({
	open,
	onOpenChange,
	updateState,
	onUpdateAction,
	onViewChangelog,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	updateState: DesktopUpdateState | null;
	onUpdateAction: () => void;
	onViewChangelog: () => void;
}) {
	const [page, setPage] = useState<SettingsPage>("general");
	const activeTabRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) return;
		const timeout = window.setTimeout(() => activeTabRef.current?.focus());
		return () => window.clearTimeout(timeout);
	}, [open]);

	return (
		<SettingsDialog
			open={open}
			onOpenChange={onOpenChange}
			title={pageTitles[page]}
			className="max-w-4xl"
		>
			<div className="flex h-[calc(100dvh-7rem)] max-h-[39rem] min-h-0">
				<nav
					data-sidebar-root
					data-settings-nav
					className="relative flex w-40 shrink-0 flex-col gap-1 border-e border-sidebar-border bg-sidebar px-4 py-1 before:absolute before:-right-px before:bottom-full before:left-0 before:h-12 before:border-e before:border-sidebar-border before:bg-sidebar before:content-['']"
				>
					<NavButton
						active={page === "general"}
						buttonRef={page === "general" ? activeTabRef : undefined}
						onClick={() => setPage("general")}
					>
						General
					</NavButton>
					<NavButton
						active={page === "chat"}
						buttonRef={page === "chat" ? activeTabRef : undefined}
						onClick={() => setPage("chat")}
					>
						Chat
					</NavButton>
					<NavButton
						active={page === "shortcuts"}
						buttonRef={page === "shortcuts" ? activeTabRef : undefined}
						onClick={() => setPage("shortcuts")}
					>
						Shortcuts
					</NavButton>
				</nav>
				<div className="min-w-0 flex-1 overflow-y-auto bg-popover">
					{page === "general" ? (
						<GeneralSettings
							updateState={updateState}
							onUpdateAction={onUpdateAction}
							onViewChangelog={onViewChangelog}
						/>
					) : page === "chat" ? (
						<ChatSettings />
					) : (
						<ShortcutSettings />
					)}
				</div>
			</div>
		</SettingsDialog>
	);
}

const pageTitles: Record<SettingsPage, string> = {
	general: "General",
	chat: "Chat",
	shortcuts: "Keyboard shortcuts",
};

function GeneralSettings({
	updateState,
	onUpdateAction,
	onViewChangelog,
}: {
	updateState: DesktopUpdateState | null;
	onUpdateAction: () => void;
	onViewChangelog: () => void;
}) {
	const spellcheck = useStoreValue(spellcheckStore);
	const telemetryConsent = useStoreValue(telemetryConsentStore);

	return (
		<div className="flex flex-col divide-y divide-border p-4">
			{updateState ? (
				<UpdatesSection
					state={updateState}
					onPrimaryAction={onUpdateAction}
					onViewChangelog={onViewChangelog}
				/>
			) : null}
			<AppearanceSettings />
			{spellcheck ? (
				<SpellcheckSettingsSection
					state={spellcheck}
					onEnabledChange={(enabled) => void setSpellcheckEnabled(enabled)}
					onLanguagesChange={(languages) =>
						void setSpellcheckLanguages(languages)
					}
				/>
			) : null}
			<CodeFilesSettings />
			{telemetryConsent ? (
				<TelemetrySettingsSection
					consent={telemetryConsent}
					onChoose={(choice) => void setTelemetryConsent(choice)}
				/>
			) : null}
		</div>
	);
}

function AppearanceSettings() {
	const theme = useStoreValue(themePreferenceStore);
	return (
		<SettingsSection
			title="Appearance"
			description="Choose the app appearance."
		>
			<div className="flex items-center gap-2">
				{(["light", "dark", "system"] as const).map((preference) => (
					<Button
						key={preference}
						size="sm"
						variant={theme === preference ? "secondary" : "outline"}
						aria-pressed={theme === preference}
						onClick={() => setThemePreference(preference)}
					>
						{preference === "system"
							? "System default"
							: `${preference[0].toUpperCase()}${preference.slice(1)}`}
					</Button>
				))}
			</div>
		</SettingsSection>
	);
}

function CodeFilesSettings() {
	const mode = useStoreValue(codeFileOpenModeStore);
	return (
		<SettingsSection
			title="Code files"
			description="Choose where code files (JavaScript, Python, etc) are opened."
		>
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					variant={mode === "hubble" ? "secondary" : "outline"}
					aria-pressed={mode === "hubble"}
					onClick={() => setCodeFileOpenMode("hubble")}
				>
					Hubble
				</Button>
				<Button
					size="sm"
					variant={mode === "default-app" ? "secondary" : "outline"}
					aria-pressed={mode === "default-app"}
					onClick={() => setCodeFileOpenMode("default-app")}
				>
					Default app
				</Button>
			</div>
		</SettingsSection>
	);
}

function ChatSettings() {
	const [draft, setDraft] = useState(() => chatCommandStore.get());

	return (
		<div className="flex flex-col divide-y divide-border p-4">
			<SettingsSection
				title="Chat about this note"
				description={`This command runs in a new terminal when you pick "Chat about this note" from a note's ⋯ menu. The shell replaces $HUBBLE_NOTE_PATH with the current note's file path.`}
			>
				<div className="relative">
					<Input
						className="font-mono pe-8"
						spellCheck={false}
						value={draft}
						onChange={(event) => {
							setDraft(event.currentTarget.value);
							setChatCommand(event.currentTarget.value);
						}}
					/>
					<MingcutePencilLine className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
				</div>
			</SettingsSection>
		</div>
	);
}

function ShortcutSettings() {
	const state = useShortcutState();
	const groups = filterShortcutGroups(state.query, state.bindings);

	return (
		<div className="p-4">
			<header className="flex gap-2">
				<Input
					className="flex-1 bg-transparent dark:bg-transparent"
					placeholder="Search shortcuts…"
					value={state.query}
					onChange={(event) => state.setQuery(event.currentTarget.value)}
				/>
				<Button variant="outline" onClick={state.resetAll}>
					Reset all
				</Button>
			</header>
			<div className="mt-4 space-y-5">
				{groups.map(({ area, commands: groupCommands }) => (
					<section key={area}>
						<h3 className="mb-1.5 text-[11px] font-semibold">{area}</h3>
						<div className="divide-y divide-border rounded-sm border border-border">
							{groupCommands.map((command) => (
								<CommandRow key={command.id} command={command} state={state} />
							))}
						</div>
					</section>
				))}
				{groups.length === 0 ? (
					<p className="py-10 text-center text-[11px] text-muted-foreground">
						No shortcuts match this search.
					</p>
				) : null}
			</div>
		</div>
	);
}

function CommandRow({
	command,
	state,
}: {
	command: ShortcutCommand;
	state: ReturnType<typeof useShortcutState>;
}) {
	const binding = resolveCommandBinding(command.id, state.bindings);
	const conflicts = findCommandBindingConflicts(command.id, state.bindings);
	const customized = isShortcutCustomized(command.id, state.bindings);
	const recording = state.recordingId === command.id;

	return (
		<div
			id={shortcutRowId(command.id)}
			tabIndex={-1}
			className="grid grid-cols-[minmax(0,1fr)_10rem] gap-4 px-3 py-2.5 outline-none"
		>
			<div className="min-w-0">
				<p className="text-[11px] font-medium">{command.label}</p>
				<p className="truncate text-[10px] text-muted-foreground">
					{command.description}
				</p>
				{state.errors[command.id] ? (
					<p className="text-[10px] text-destructive">
						{state.errors[command.id]}
					</p>
				) : null}
				{conflicts.length > 0 ? (
					<p className="text-[10px] text-amber-700 dark:text-amber-400">
						Also assigned to{" "}
						{conflicts.map((id, index) => (
							<span key={id}>
								{conflictSeparator(index, conflicts.length)}
								<button
									type="button"
									className="font-medium underline underline-offset-2 hover:text-foreground"
									onClick={() => state.reveal(id)}
								>
									{getCommand(id).label}
								</button>
							</span>
						))}
					</p>
				) : null}
			</div>
			<div className="flex min-w-0 items-center justify-end gap-1.5">
				<div className="size-6 shrink-0">
					{customized ? (
						<Button
							variant="ghost"
							size="icon-xs"
							className="active:translate-y-0"
							aria-label={`Reset ${command.label}`}
							title="Reset to default"
							onClick={() => state.reset(command.id)}
						>
							<MingcuteRefresh2Line />
						</Button>
					) : null}
				</div>
				<div className="relative min-w-0 flex-1">
					<Button
						variant={recording ? "secondary" : "outline"}
						size="sm"
						className={`w-full min-w-0 justify-center font-sans text-xs tracking-[0.02em] tabular-nums ${
							recording ? "px-2" : "px-8"
						}`}
						aria-pressed={recording}
						onClick={() => state.startRecording(command.id)}
					>
						<span
							className={`min-w-0 truncate text-center ${
								recording || !binding
									? "font-normal text-muted-foreground"
									: "font-medium text-foreground"
							}`}
						>
							{recording
								? "Press keys…"
								: binding
									? formatShortcut(binding)
									: "Not set"}
						</span>
					</Button>
					{binding && !recording ? (
						<Button
							variant="ghost"
							size="icon-xs"
							className="absolute top-1/2 right-1 -translate-y-1/2 active:-translate-y-1/2"
							aria-label={`Disable ${command.label}`}
							title="Disable shortcut"
							onClick={() => state.clear(command.id)}
						>
							<MingcuteCloseLine />
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}

function useShortcutState() {
	const bindings = useStoreValue(shortcutBindingsStore);
	const [errors, setErrors] = useState<Errors>({});
	const [recordingId, setRecordingId] = useState<CommandId | null>(null);
	const [query, setQuery] = useState("");
	// Conflict links change this ID to scroll to and pulse the matching row.
	const [revealId, setRevealId] = useState<CommandId | null>(null);

	useEffect(() => {
		if (!revealId) return;
		const frame = requestAnimationFrame(() => {
			const row = document.getElementById(shortcutRowId(revealId));
			if (!row) return;
			row.scrollIntoView({
				behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
					? "auto"
					: "smooth",
				block: "center",
			});
			row.focus({ preventScroll: true });
			pulseShortcutRow(row);
			setRevealId(null);
		});
		return () => cancelAnimationFrame(frame);
	}, [revealId]);

	useEffect(() => {
		if (!recordingId) return;

		const record = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();

			if (event.key === "Escape") {
				setRecordingId(null);
				setErrors((current) => ({ ...current, [recordingId]: undefined }));
				return;
			}
			if (
				(event.key === "Backspace" || event.key === "Delete") &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey
			) {
				setShortcutBinding(recordingId, null);
				setRecordingId(null);
				setErrors((current) => ({ ...current, [recordingId]: undefined }));
				return;
			}

			const binding = shortcutBindingFromEvent(event);
			if (!binding) return;
			const error = validateShortcutBinding(binding);
			if (error) {
				setErrors((current) => ({ ...current, [recordingId]: error }));
				return;
			}

			setShortcutBinding(recordingId, binding);
			setErrors((current) => ({ ...current, [recordingId]: undefined }));
			setRecordingId(null);
		};

		const onBlur = () => {
			setErrors((current) => ({
				...current,
				[recordingId]:
					"The operating system may have intercepted that shortcut. Press another combination or Escape.",
			}));
		};
		window.addEventListener("keydown", record, true);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keydown", record, true);
			window.removeEventListener("blur", onBlur);
		};
	}, [recordingId]);

	const clearError = (id: CommandId) =>
		setErrors((current) => ({ ...current, [id]: undefined }));

	return {
		bindings,
		clear: (id: CommandId) => {
			setShortcutBinding(id, null);
			clearError(id);
			if (recordingId === id) setRecordingId(null);
		},
		errors,
		query,
		recordingId,
		reveal: (id: CommandId) => {
			setQuery("");
			setRevealId(id);
		},
		reset: (id: CommandId) => {
			setShortcutBinding(id, getCommand(id).defaultBinding);
			clearError(id);
			if (recordingId === id) setRecordingId(null);
		},
		resetAll: () => {
			resetShortcutBindings();
			setErrors({});
			setRecordingId(null);
		},
		setQuery,
		startRecording: (id: CommandId) => {
			clearError(id);
			setRecordingId(id);
		},
	};
}

function shortcutRowId(id: CommandId) {
	return `shortcut-${id}`;
}

function conflictSeparator(index: number, count: number) {
	if (index === 0) return "";
	if (index === count - 1) return count === 2 ? " and " : ", and ";
	return ", ";
}

function pulseShortcutRow(row: HTMLElement) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	row.animate(
		[
			{ backgroundColor: "transparent" },
			{
				backgroundColor:
					"color-mix(in oklab, var(--brand-accent) 24%, transparent)",
			},
			{ backgroundColor: "transparent" },
		],
		{ duration: 700, easing: "ease-out" },
	);
}

function NavButton({
	active,
	buttonRef,
	children,
	onClick,
}: {
	active: boolean;
	buttonRef?: Ref<HTMLButtonElement>;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			className={`flex h-8 items-center rounded-sm px-2 text-left text-[11px] font-medium transition-colors ${
				active
					? "bg-sidebar-accent text-sidebar-accent-foreground"
					: "text-muted-foreground hover:bg-accent hover:text-foreground"
			}`}
			aria-current={active ? "page" : undefined}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
