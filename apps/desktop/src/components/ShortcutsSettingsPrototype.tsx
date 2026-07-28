import { Button, formatShortcut, Input } from "@hubble.md/ui";
import { isMac } from "keymatch";
import { type ReactNode, useCallback, useEffect, useState } from "react";

// PROTOTYPE — three variants of the Shortcuts settings page, switchable via
// `?variant=`, inside the existing Settings dialog. Throw away after #194
// chooses a direction.

const variants = [
	{ id: "sidebar", label: "Sidebar navigator" },
	{ id: "tabs", label: "Grouped cards" },
	{ id: "table", label: "Command table" },
] as const;

type Variant = (typeof variants)[number]["id"];
type Area = "App" | "Editor";

type Command = {
	id: string;
	label: string;
	description: string;
	area: Area;
	defaultBinding: string;
};

type Bindings = Record<string, string | null>;
type Errors = Record<string, string | undefined>;

const commands: Command[] = [
	{
		id: "app.new-file",
		label: "New File",
		description: "Create a Markdown File in the open folder.",
		area: "App",
		defaultBinding: "CmdOrCtrl+N",
	},
	{
		id: "app.add-folder",
		label: "Add Folder",
		description: "Choose a folder to add as a workspace.",
		area: "App",
		defaultBinding: "CmdOrCtrl+Shift+N",
	},
	{
		id: "app.open-file",
		label: "Open",
		description: "Choose a file from the filesystem.",
		area: "App",
		defaultBinding: "CmdOrCtrl+O",
	},
	{
		id: "app.open-folder",
		label: "Open Folder",
		description: "Switch to another recent open folder.",
		area: "App",
		defaultBinding: "CmdOrCtrl+Shift+O",
	},
	{
		id: "app.go-to-file",
		label: "Go to File",
		description: "Search files in the current open folder.",
		area: "App",
		defaultBinding: "CmdOrCtrl+P",
	},
	{
		id: "app.settings",
		label: "Settings",
		description: "Open Hubble settings.",
		area: "App",
		defaultBinding: "CmdOrCtrl+,",
	},
	{
		id: "app.go-back",
		label: "Go Back",
		description: "Move backward through file history.",
		area: "App",
		defaultBinding: "CmdOrCtrl+[",
	},
	{
		id: "app.go-forward",
		label: "Go Forward",
		description: "Move forward through file history.",
		area: "App",
		defaultBinding: "CmdOrCtrl+]",
	},
	{
		id: "app.toggle-terminal",
		label: "Toggle Terminal",
		description: "Show or hide the terminal panel.",
		area: "App",
		defaultBinding: "CmdOrCtrl+J",
	},
	{
		id: "app.toggle-source-mode",
		label: "Toggle Source Mode",
		description: "Switch between rich and source editing.",
		area: "App",
		defaultBinding: "Alt+CmdOrCtrl+U",
	},
	{
		id: "app.copy-as-markdown",
		label: "Copy as Markdown",
		description: "Copy the current selection as Markdown.",
		area: "App",
		defaultBinding: "Alt+CmdOrCtrl+C",
	},
	{
		id: "app.copy-path",
		label: "Copy File Path",
		description: "Copy the selected file path.",
		area: "App",
		defaultBinding: "CmdOrCtrl+Shift+C",
	},
	{
		id: "app.reveal",
		label: "Reveal in File Manager",
		description: "Reveal the selected item in Finder or Explorer.",
		area: "App",
		defaultBinding: "CmdOrCtrl+Alt+R",
	},
	{
		id: "app.chat-about-note",
		label: "Chat About Note",
		description: "Open the configured agent command for this note.",
		area: "App",
		defaultBinding: "CmdOrCtrl+Shift+J",
	},
	{
		id: "app.toggle-sidebar",
		label: "Toggle Sidebar",
		description: "Show or hide the file sidebar.",
		area: "App",
		defaultBinding: "CmdOrCtrl+Shift+E",
	},
	{
		id: "app.delete",
		label: "Delete",
		description: "Delete the selected file or folder.",
		area: "App",
		defaultBinding: "CmdOrCtrl+Backspace",
	},
	{
		id: "app.find",
		label: "Find",
		description: "Find text in the current file.",
		area: "App",
		defaultBinding: "CmdOrCtrl+F",
	},
	{
		id: "app.format-menu",
		label: "Format",
		description: "Open the editor formatting menu.",
		area: "App",
		defaultBinding: "CmdOrCtrl+/",
	},
	{
		id: "editor.link",
		label: "Link",
		description: "Add or edit a link.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+K",
	},
	{
		id: "editor.strike",
		label: "Strikethrough",
		description: "Toggle strikethrough formatting.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Shift+X",
	},
	{
		id: "editor.ordered-list",
		label: "Numbered List",
		description: "Toggle a numbered list.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Shift+7",
	},
	{
		id: "editor.bullet-list",
		label: "Bulleted List",
		description: "Toggle a bulleted list.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Shift+8",
	},
	{
		id: "editor.task-list",
		label: "To-do List",
		description: "Toggle a to-do list.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Shift+9",
	},
	{
		id: "editor.bold",
		label: "Bold",
		description: "Toggle bold formatting.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+B",
	},
	{
		id: "editor.italic",
		label: "Italic",
		description: "Toggle italic formatting.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+I",
	},
	{
		id: "editor.code",
		label: "Inline Code",
		description: "Toggle inline code formatting.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+E",
	},
	{
		id: "editor.heading-1",
		label: "Heading 1",
		description: "Convert the current block to heading 1.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Alt+1",
	},
	{
		id: "editor.heading-2",
		label: "Heading 2",
		description: "Convert the current block to heading 2.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Alt+2",
	},
	{
		id: "editor.heading-3",
		label: "Heading 3",
		description: "Convert the current block to heading 3.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Alt+3",
	},
	{
		id: "editor.heading-4",
		label: "Heading 4",
		description: "Convert the current block to heading 4.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Alt+4",
	},
	{
		id: "editor.heading-5",
		label: "Heading 5",
		description: "Convert the current block to heading 5.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Alt+5",
	},
	{
		id: "editor.heading-6",
		label: "Heading 6",
		description: "Convert the current block to heading 6.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Alt+6",
	},
	{
		id: "editor.blockquote",
		label: "Quote",
		description: "Toggle block quote formatting.",
		area: "Editor",
		defaultBinding: "CmdOrCtrl+Shift+B",
	},
];

const modifierOrder = ["CmdOrCtrl", "Ctrl", "Alt", "Shift", "Super"] as const;
const modifierSet = new Set<string>(modifierOrder);

function normalizeBinding(binding: string) {
	const parts = binding.split("+");
	const modifiers = modifierOrder.filter((modifier) =>
		parts.includes(modifier),
	);
	const keys = parts.filter((part) => !modifierSet.has(part));
	return [...modifiers, ...keys].join("+");
}

function defaultBinding(command: Command) {
	return normalizeBinding(command.defaultBinding);
}

const fixedBindings = new Set(
	[
		"CmdOrCtrl+A",
		"CmdOrCtrl+C",
		"CmdOrCtrl+=",
		"CmdOrCtrl+-",
		"CmdOrCtrl+0",
		"CmdOrCtrl+Q",
		"CmdOrCtrl+V",
		"CmdOrCtrl+X",
		"CmdOrCtrl+Y",
		"CmdOrCtrl+Z",
		"CmdOrCtrl+Shift+Z",
	].map(normalizeBinding),
);

const unavailableBindings = new Set(
	(isMac() ? ["CmdOrCtrl+Space", "CmdOrCtrl+Tab"] : ["Alt+F4", "Alt+Tab"]).map(
		normalizeBinding,
	),
);

function validateBinding(
	commandId: string,
	binding: string,
	bindings: Bindings,
) {
	const parts = binding.split("+");
	if (parts.some((part) => part.length === 0)) {
		return "That key cannot be used in a Hubble shortcut.";
	}
	if (parts.includes("Super")) {
		return "The system key is not available for app shortcuts.";
	}
	if (
		!parts.some(
			(part) => part === "CmdOrCtrl" || part === "Ctrl" || part === "Alt",
		)
	) {
		return "Add Command, Control, or Alt to create a shortcut.";
	}
	if (unavailableBindings.has(binding)) {
		return `${formatShortcut(binding)} is unavailable on this operating system.`;
	}
	if (fixedBindings.has(binding)) {
		return `${formatShortcut(binding)} stays fixed in Hubble.`;
	}
	const duplicate = commands.find(
		(command) => command.id !== commandId && bindings[command.id] === binding,
	);
	return duplicate ? `Already assigned to ${duplicate.label}.` : undefined;
}

function variantFromUrl(): Variant | null {
	const requested = new URLSearchParams(window.location.search).get("variant");
	return variants.some(({ id }) => id === requested)
		? (requested as Variant)
		: null;
}

function initialBindings(): Bindings {
	return Object.fromEntries(
		commands.map((command) => [command.id, defaultBinding(command)]),
	);
}

function eventBinding(event: KeyboardEvent): string | null {
	const keyAliases: Record<string, string> = {
		" ": "Space",
		ArrowDown: "Down",
		ArrowLeft: "Left",
		ArrowRight: "Right",
		ArrowUp: "Up",
	};
	const key =
		// Match keymatch's physical semantics for letters and digits, including
		// when Alt or Shift composition reports punctuation or a dead key.
		/^Key[A-Z]$/.test(event.code)
			? event.code.slice(3)
			: /^Digit[0-9]$/.test(event.code)
				? event.code.slice(5)
				: (keyAliases[event.key] ?? event.key);
	if (["Alt", "Control", "Meta", "Shift"].includes(key)) return null;

	const parts: string[] = [];
	if (event.ctrlKey) parts.push(isMac() ? "Ctrl" : "CmdOrCtrl");
	if (event.metaKey) parts.push(isMac() ? "CmdOrCtrl" : "Super");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	parts.push(key.length === 1 ? key.toUpperCase() : key);
	return normalizeBinding(parts.join("+"));
}

function isTypingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.matches("input, textarea, select") ||
		target.closest("[contenteditable='true']") !== null
	);
}

function usePrototypeState() {
	const [bindings, setBindings] = useState<Bindings>(() => {
		const initial = initialBindings();
		initial["app.new-file"] = "CmdOrCtrl+Alt+N";
		initial["app.chat-about-note"] = null;
		return initial;
	});
	const [errors, setErrors] = useState<Errors>({});
	const [recordingId, setRecordingId] = useState<string | null>(null);
	const [query, setQuery] = useState("");

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
				setBindings((current) => ({ ...current, [recordingId]: null }));
				setRecordingId(null);
				setErrors((current) => ({ ...current, [recordingId]: undefined }));
				return;
			}

			const binding = eventBinding(event);
			if (!binding) return;
			const error = validateBinding(recordingId, binding, bindings);
			if (error) {
				setErrors((current) => ({
					...current,
					[recordingId]: error,
				}));
				return;
			}

			setBindings((current) => ({ ...current, [recordingId]: binding }));
			setErrors((current) => ({ ...current, [recordingId]: undefined }));
			setRecordingId(null);
		};

		window.addEventListener("keydown", record, true);
		const onWindowBlur = () => {
			setErrors((current) => ({
				...current,
				[recordingId]:
					"The operating system may have intercepted that shortcut. Press another combination or Escape.",
			}));
		};
		window.addEventListener("blur", onWindowBlur);
		return () => {
			window.removeEventListener("keydown", record, true);
			window.removeEventListener("blur", onWindowBlur);
		};
	}, [bindings, recordingId]);

	const reset = (command: Command) => {
		const binding = defaultBinding(command);
		const error = validateBinding(command.id, binding, bindings);
		if (error) {
			setErrors((current) => ({ ...current, [command.id]: error }));
			if (recordingId === command.id) setRecordingId(null);
			return;
		}
		setBindings((current) => ({
			...current,
			[command.id]: binding,
		}));
		setErrors((current) => ({ ...current, [command.id]: undefined }));
		if (recordingId === command.id) setRecordingId(null);
	};

	const clear = (command: Command) => {
		setBindings((current) => ({ ...current, [command.id]: null }));
		setErrors((current) => ({ ...current, [command.id]: undefined }));
		if (recordingId === command.id) setRecordingId(null);
	};

	const resetAll = () => {
		setBindings(initialBindings());
		setErrors({});
		setRecordingId(null);
	};

	return {
		bindings,
		clear,
		errors,
		query,
		recordingId,
		reset,
		resetAll,
		setQuery,
		startRecording: (id: string) => {
			setErrors((current) => ({ ...current, [id]: undefined }));
			setRecordingId(id);
		},
	};
}

type PrototypeState = ReturnType<typeof usePrototypeState>;

type PrototypeProps = {
	general: ReactNode;
	page: "general" | "shortcuts";
	setPage: (page: "general" | "shortcuts") => void;
	state: PrototypeState;
};

export function ShortcutsSettingsPrototype({
	general,
}: {
	general: ReactNode;
}) {
	const [variant, setVariant] = useState<Variant>(
		() => variantFromUrl() ?? "sidebar",
	);
	const [page, setPage] = useState<"general" | "shortcuts">("shortcuts");
	const state = usePrototypeState();

	const chooseVariant = useCallback((next: Variant) => {
		const url = new URL(window.location.href);
		url.searchParams.set("variant", next);
		window.history.replaceState(null, "", url);
		setVariant(next);
	}, []);

	useEffect(() => {
		const cycle = (direction: -1 | 1) => {
			const currentIndex = variants.findIndex(({ id }) => id === variant);
			const nextIndex =
				(currentIndex + direction + variants.length) % variants.length;
			chooseVariant(variants[nextIndex].id);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (isTypingTarget(event.target) || state.recordingId) return;
			if (event.key === "ArrowLeft") cycle(-1);
			if (event.key === "ArrowRight") cycle(1);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [chooseVariant, state.recordingId, variant]);

	const props = { general, page, setPage, state };

	return (
		<>
			{variant === "sidebar" ? (
				<SidebarVariant {...props} />
			) : variant === "tabs" ? (
				<TabsVariant {...props} />
			) : (
				<TableVariant {...props} />
			)}
			<PrototypeSwitcher
				current={variant}
				onChange={chooseVariant}
				recording={state.recordingId !== null}
			/>
		</>
	);
}

function SidebarVariant({ general, page, setPage, state }: PrototypeProps) {
	return (
		<div className="flex h-[calc(100dvh-9rem)] max-h-[38rem] min-h-0 overflow-hidden rounded-sm border border-border bg-card">
			<nav className="flex w-40 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-2">
				<p className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
					Settings
				</p>
				<NavButton
					active={page === "general"}
					onClick={() => setPage("general")}
				>
					General
				</NavButton>
				<NavButton
					active={page === "shortcuts"}
					onClick={() => setPage("shortcuts")}
					count={commands.length}
				>
					Shortcuts
				</NavButton>
				<div className="mt-auto rounded-sm border border-border bg-background/70 p-2 text-[10px] leading-relaxed text-muted-foreground">
					Prototype A
					<br />
					Navigation scales as more settings pages are added.
				</div>
			</nav>
			<div className="min-w-0 flex-1 overflow-y-auto">
				{page === "general" ? (
					<GeneralPane>{general}</GeneralPane>
				) : (
					<ShortcutList state={state} />
				)}
			</div>
		</div>
	);
}

function TabsVariant({ general, page, setPage, state }: PrototypeProps) {
	const filtered = filteredCommands(state.query);
	return (
		<div className="flex h-[calc(100dvh-9rem)] max-h-[38rem] min-h-0 flex-col overflow-hidden rounded-sm border border-border bg-card">
			<div className="border-b border-border px-4 pt-2">
				<div className="flex gap-5">
					<TabButton
						active={page === "general"}
						onClick={() => setPage("general")}
					>
						General
					</TabButton>
					<TabButton
						active={page === "shortcuts"}
						onClick={() => setPage("shortcuts")}
					>
						Shortcuts
					</TabButton>
				</div>
			</div>
			{page === "general" ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<GeneralPane>{general}</GeneralPane>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<ShortcutHeader state={state} />
					<div className="mt-4 grid gap-4 md:grid-cols-2">
						{(["App", "Editor"] as const).map((area) => (
							<section
								key={area}
								className="overflow-hidden rounded-sm border border-border"
							>
								<header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
									<h3 className="text-xs font-semibold">{area}</h3>
									<span className="text-[10px] text-muted-foreground">
										{filtered.filter((command) => command.area === area).length}
									</span>
								</header>
								<div className="divide-y divide-border">
									{filtered
										.filter((command) => command.area === area)
										.map((command) => (
											<CardCommandRow
												key={command.id}
												command={command}
												state={state}
											/>
										))}
								</div>
							</section>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function TableVariant({ general, page, setPage, state }: PrototypeProps) {
	const filtered = filteredCommands(state.query);
	return (
		<div className="flex h-[calc(100dvh-9rem)] max-h-[38rem] min-h-0 flex-col overflow-hidden rounded-sm border border-border bg-card">
			<header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-3 py-2">
				<div className="flex rounded-sm border border-border bg-background p-0.5">
					<SegmentButton
						active={page === "general"}
						onClick={() => setPage("general")}
					>
						General
					</SegmentButton>
					<SegmentButton
						active={page === "shortcuts"}
						onClick={() => setPage("shortcuts")}
					>
						Shortcuts
					</SegmentButton>
				</div>
				{page === "shortcuts" ? (
					<>
						<Input
							className="ml-auto max-w-56"
							placeholder="Filter commands…"
							value={state.query}
							onChange={(event) => state.setQuery(event.currentTarget.value)}
						/>
						<Button variant="ghost" size="xs" onClick={state.resetAll}>
							Reset all
						</Button>
					</>
				) : null}
			</header>
			{page === "general" ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<GeneralPane>{general}</GeneralPane>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="grid grid-cols-[5rem_minmax(10rem,1fr)_11rem_5rem] border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
						<span>Area</span>
						<span>Command</span>
						<span>Binding</span>
						<span className="text-right">Action</span>
					</div>
					<div className="divide-y divide-border">
						{filtered.map((command) => (
							<TableCommandRow
								key={command.id}
								command={command}
								state={state}
							/>
						))}
					</div>
					{filtered.length === 0 ? <EmptySearch /> : null}
				</div>
			)}
		</div>
	);
}

function ShortcutList({ state }: { state: PrototypeState }) {
	const filtered = filteredCommands(state.query);
	return (
		<div className="p-4">
			<ShortcutHeader state={state} />
			<div className="mt-4 space-y-5">
				{(["App", "Editor"] as const).map((area) => (
					<section key={area}>
						<div className="mb-1.5 flex items-center justify-between">
							<h3 className="text-[11px] font-semibold">{area}</h3>
							<span className="text-[10px] text-muted-foreground">
								{filtered.filter((command) => command.area === area).length}{" "}
								commands
							</span>
						</div>
						<div className="divide-y divide-border rounded-sm border border-border">
							{filtered
								.filter((command) => command.area === area)
								.map((command) => (
									<ListCommandRow
										key={command.id}
										command={command}
										state={state}
									/>
								))}
						</div>
					</section>
				))}
				{filtered.length === 0 ? <EmptySearch /> : null}
			</div>
		</div>
	);
}

function ShortcutHeader({ state }: { state: PrototypeState }) {
	return (
		<header className="flex flex-wrap items-start gap-3">
			<div>
				<h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
				<p className="mt-0.5 text-[11px] text-muted-foreground">
					Select a binding, then press a new key combination.
				</p>
			</div>
			<div className="ml-auto flex items-center gap-2">
				<Input
					className="w-48"
					placeholder="Search shortcuts…"
					value={state.query}
					onChange={(event) => state.setQuery(event.currentTarget.value)}
				/>
				<Button variant="outline" size="sm" onClick={state.resetAll}>
					Reset all
				</Button>
			</div>
		</header>
	);
}

function ListCommandRow({
	command,
	state,
}: {
	command: Command;
	state: PrototypeState;
}) {
	const binding = state.bindings[command.id];
	const customized = binding !== defaultBinding(command);
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_12rem] gap-4 px-3 py-2.5">
			<div className="min-w-0">
				<p className="text-[11px] font-medium">{command.label}</p>
				<p className="truncate text-[10px] text-muted-foreground">
					{command.description}
				</p>
				<BindingError error={state.errors[command.id]} />
			</div>
			<div className="flex items-center justify-end gap-1.5">
				<BindingButton command={command} state={state} />
				{customized ? (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Reset ${command.label}`}
						title="Reset to default"
						onClick={() => state.reset(command)}
					>
						↺
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Disable ${command.label}`}
					title="Disable shortcut"
					onClick={() => state.clear(command)}
				>
					×
				</Button>
			</div>
		</div>
	);
}

function CardCommandRow({
	command,
	state,
}: {
	command: Command;
	state: PrototypeState;
}) {
	const binding = state.bindings[command.id];
	return (
		<div className="p-3">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="text-[11px] font-medium">{command.label}</p>
					<p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
						{command.description}
					</p>
				</div>
				<BindingButton command={command} state={state} />
			</div>
			<div className="mt-2 flex min-h-5 items-center gap-2">
				<BindingError error={state.errors[command.id]} />
				{state.errors[command.id] ? null : (
					<p className="text-[10px] text-muted-foreground">
						{binding === null
							? "Disabled"
							: binding === defaultBinding(command)
								? "Default"
								: "Customized"}
					</p>
				)}
				<div className="ml-auto flex gap-1">
					{binding !== defaultBinding(command) ? (
						<Button
							variant="link"
							size="xs"
							onClick={() => state.reset(command)}
						>
							Reset
						</Button>
					) : null}
					<Button variant="link" size="xs" onClick={() => state.clear(command)}>
						Disable
					</Button>
				</div>
			</div>
		</div>
	);
}

function TableCommandRow({
	command,
	state,
}: {
	command: Command;
	state: PrototypeState;
}) {
	const binding = state.bindings[command.id];
	return (
		<div>
			<div className="grid grid-cols-[5rem_minmax(10rem,1fr)_11rem_5rem] items-center gap-0 px-3 py-2">
				<span className="text-[10px] text-muted-foreground">
					{command.area}
				</span>
				<div className="min-w-0">
					<p className="truncate text-[11px] font-medium">{command.label}</p>
					<p className="truncate text-[9px] text-muted-foreground">
						{command.description}
					</p>
				</div>
				<BindingButton command={command} state={state} />
				<div className="flex justify-end">
					{binding !== defaultBinding(command) ? (
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Reset ${command.label}`}
							title="Reset to default"
							onClick={() => state.reset(command)}
						>
							↺
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Disable ${command.label}`}
						title="Disable shortcut"
						onClick={() => state.clear(command)}
					>
						×
					</Button>
				</div>
			</div>
			<BindingError
				className="pb-1.5 pl-[calc(5rem+0.75rem)]"
				error={state.errors[command.id]}
			/>
		</div>
	);
}

function BindingButton({
	command,
	state,
}: {
	command: Command;
	state: PrototypeState;
}) {
	const binding = state.bindings[command.id];
	const recording = state.recordingId === command.id;
	return (
		<Button
			variant={recording ? "secondary" : "outline"}
			size="sm"
			className="min-w-28 font-mono"
			aria-pressed={recording}
			onClick={() => state.startRecording(command.id)}
		>
			{recording
				? "Press keys…"
				: binding
					? formatShortcut(binding)
					: "Not set"}
		</Button>
	);
}

function BindingError({
	error,
	className = "",
}: {
	error?: string;
	className?: string;
}) {
	return error ? (
		<p className={`text-[10px] text-destructive ${className}`}>{error}</p>
	) : null;
}

function GeneralPane({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col divide-y divide-border p-4">{children}</div>
	);
}

function NavButton({
	active,
	children,
	count,
	onClick,
}: {
	active: boolean;
	children: ReactNode;
	count?: number;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={`flex h-8 items-center rounded-sm px-2 text-left text-[11px] font-medium transition-colors ${
				active
					? "bg-background text-foreground shadow-sm"
					: "text-muted-foreground hover:bg-background/60 hover:text-foreground"
			}`}
			aria-current={active ? "page" : undefined}
			onClick={onClick}
		>
			<span>{children}</span>
			{count ? (
				<span className="ml-auto text-[9px] text-muted-foreground">
					{count}
				</span>
			) : null}
		</button>
	);
}

function TabButton({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={`border-b-2 px-0.5 py-2 text-[11px] font-medium transition-colors ${
				active
					? "border-foreground text-foreground"
					: "border-transparent text-muted-foreground hover:text-foreground"
			}`}
			aria-current={active ? "page" : undefined}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function SegmentButton({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={`rounded-[2px] px-2 py-1 text-[10px] font-medium ${
				active
					? "bg-secondary text-foreground"
					: "text-muted-foreground hover:text-foreground"
			}`}
			aria-pressed={active}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function EmptySearch() {
	return (
		<p className="py-10 text-center text-[11px] text-muted-foreground">
			No shortcuts match this search.
		</p>
	);
}

function filteredCommands(query: string) {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return commands;
	return commands.filter((command) =>
		`${command.label} ${command.description} ${command.id} ${command.area}`
			.toLocaleLowerCase()
			.includes(needle),
	);
}

function PrototypeSwitcher({
	current,
	onChange,
	recording,
}: {
	current: Variant;
	onChange: (variant: Variant) => void;
	recording: boolean;
}) {
	const currentIndex = variants.findIndex(({ id }) => id === current);
	const cycle = (direction: -1 | 1) => {
		const nextIndex =
			(currentIndex + direction + variants.length) % variants.length;
		onChange(variants[nextIndex].id);
	};
	const currentVariant = variants[currentIndex];

	return (
		<div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-neutral-950 px-2 py-1.5 text-white shadow-xl">
			<button
				type="button"
				className="flex size-7 items-center justify-center rounded-full text-sm hover:bg-white/10 disabled:opacity-40"
				aria-label="Previous prototype variant"
				disabled={recording}
				onClick={() => cycle(-1)}
			>
				←
			</button>
			<div className="min-w-44 text-center text-[10px] leading-tight">
				<div>
					<span className="font-semibold uppercase">{currentVariant.id}</span>
					<span className="text-white/60"> — {currentVariant.label}</span>
				</div>
				<div className="mt-0.5 text-[9px] text-white/45">
					Mock data · resets on reload
				</div>
			</div>
			<button
				type="button"
				className="flex size-7 items-center justify-center rounded-full text-sm hover:bg-white/10 disabled:opacity-40"
				aria-label="Next prototype variant"
				disabled={recording}
				onClick={() => cycle(1)}
			>
				→
			</button>
		</div>
	);
}
