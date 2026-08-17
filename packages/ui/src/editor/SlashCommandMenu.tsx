import type { CommandId } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { Command } from "cmdk";
import {
	type ComponentType,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import MingcuteBorderHorizontalLine from "~icons/mingcute/border-horizontal-line";
import MingcuteHeading1Line from "~icons/mingcute/heading-1-line";
import MingcuteHeading2Line from "~icons/mingcute/heading-2-line";
import MingcuteHeading3Line from "~icons/mingcute/heading-3-line";
import MingcuteListCheck2Line from "~icons/mingcute/list-check-2-line";
import MingcuteListCheckLine from "~icons/mingcute/list-check-line";
import MingcuteListOrderedLine from "~icons/mingcute/list-ordered-line";
import MingcuteQuoteLeftLine from "~icons/mingcute/quote-left-line";
import MingcuteStrikethroughLine from "~icons/mingcute/strikethrough-line";
import MingcuteTable2Line from "~icons/mingcute/table-2-line";
import MingcuteTextLine from "~icons/mingcute/text-line";
import { formatCommandShortcut } from "../lib/shortcut";
import { cn } from "../lib/utils";
import { useCommandMenuPosition } from "./commandMenuPosition";
import {
	applySlashCommand,
	findSlashToken,
	type SlashCommandKind,
	type SlashToken,
} from "./slashCommandActions";

export type SlashTemplateChoice = {
	id: string;
	title: string;
	description?: string;
	library?: string;
	path?: string;
	isDefault?: boolean;
	keywords?: string[];
};

type SlashMenuKind = SlashCommandKind | "template";

type SlashCommand = {
	kind: SlashMenuKind;
	title: string;
	description: string;
	aliases: string[];
	icon: ComponentType<{ className?: string }>;
	// Stable registry ID. Omit when the command has no shortcut.
	shortcut?: CommandId;
};

type MenuPosition = {
	x: number;
	y: number;
};

const SLASH_COMMANDS: SlashCommand[] = [
	{
		kind: "paragraph",
		title: "Text",
		description: "Start a plain text block",
		aliases: ["paragraph", "plain"],
		icon: MingcuteTextLine,
	},
	{
		kind: "heading1",
		title: "Heading 1",
		description: "Large section heading",
		aliases: ["h1", "#", "title"],
		icon: MingcuteHeading1Line,
	},
	{
		kind: "heading2",
		title: "Heading 2",
		description: "Medium section heading",
		aliases: ["h2", "##", "subtitle"],
		icon: MingcuteHeading2Line,
	},
	{
		kind: "heading3",
		title: "Heading 3",
		description: "Small section heading",
		aliases: ["h3", "###"],
		icon: MingcuteHeading3Line,
	},
	{
		kind: "bulletList",
		title: "Bulleted list",
		description: "Create a simple list",
		aliases: ["bullet", "bullets", "ul", "list"],
		icon: MingcuteListCheckLine,
		shortcut: "editor.bullet-list",
	},
	{
		kind: "orderedList",
		title: "Numbered list",
		description: "Create an ordered list",
		aliases: ["number", "numbered", "ol", "1."],
		icon: MingcuteListOrderedLine,
		shortcut: "editor.ordered-list",
	},
	{
		kind: "taskList",
		title: "To-do list",
		description: "Create a task list",
		aliases: ["todo", "task", "check", "checkbox"],
		icon: MingcuteListCheck2Line,
		shortcut: "editor.task-list",
	},
	{
		kind: "blockquote",
		title: "Quote",
		description: "Create a quote block",
		aliases: ["blockquote", ">"],
		icon: MingcuteQuoteLeftLine,
	},
	{
		kind: "divider",
		title: "Divider",
		description: "Separate sections",
		aliases: ["hr", "horizontal", "rule", "separator", "---"],
		icon: MingcuteBorderHorizontalLine,
	},
	{
		kind: "strike",
		title: "Strikethrough",
		description: "Toggle strikethrough",
		aliases: ["strike", "s", "delete"],
		icon: MingcuteStrikethroughLine,
		shortcut: "editor.strike",
	},
	{
		kind: "table",
		title: "Table",
		description: "Insert a table",
		aliases: ["table", "grid"],
		icon: MingcuteTable2Line,
	},
];

const TEMPLATE_COMMAND: SlashCommand = {
	kind: "template",
	title: "Template",
	description: "Insert a Markdown template",
	aliases: ["template", "templates"],
	icon: MingcuteTextLine,
};

// Table cells only hold inline content, so block commands are hidden there.
const INLINE_COMMANDS = new Set<SlashCommandKind>(["strike"]);

export function SlashCommandMenu({
	editor,
	viewportRef,
	templateChoices = [],
	loadTemplateChoices,
	onSelectTemplate,
}: {
	editor: Editor | null;
	viewportRef: RefObject<HTMLDivElement | null>;
	templateChoices?: SlashTemplateChoice[];
	loadTemplateChoices?: () => Promise<SlashTemplateChoice[]>;
	onSelectTemplate?: (choice: SlashTemplateChoice, token: SlashToken) => void;
}) {
	const [token, setToken] = useState<SlashToken | null>(null);
	const [position, setPosition] = useState<MenuPosition | null>(null);
	const [selectedKind, setSelectedKind] = useState<SlashMenuKind>("paragraph");
	const [mode, setMode] = useState<"commands" | "templates">("commands");
	const [templateSearch, setTemplateSearch] = useState("");
	const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
	const [loadedTemplateChoices, setLoadedTemplateChoices] = useState<
		SlashTemplateChoice[] | null
	>(null);
	const suppressedFromRef = useRef<number | null>(null);
	const positionedFromRef = useRef<number | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const templateInputRef = useRef<HTMLInputElement | null>(null);
	const insideTable = editor?.isActive("table") ?? false;
	const templatesEnabled = templateChoices.length > 0 && !!onSelectTemplate;
	const commands = useMemo(
		() =>
			templatesEnabled ? [...SLASH_COMMANDS, TEMPLATE_COMMAND] : SLASH_COMMANDS,
		[templatesEnabled],
	);
	const visibleCommands = useMemo(
		() =>
			commands.filter(
				(command) =>
					matchesCommand(command, token?.query ?? "") &&
					(!insideTable ||
						command.kind === "template" ||
						isInlineCommand(command)),
			),
		[commands, insideTable, token?.query],
	);
	const availableTemplateChoices = loadedTemplateChoices ?? templateChoices;
	const visibleTemplates = useMemo(
		() =>
			availableTemplateChoices.filter(
				(choice) => templateChoiceScore(choice, templateSearch) > 0,
			),
		[availableTemplateChoices, templateSearch],
	);
	// Keep selection visible even when the current query filters out the
	// previously selected command.
	const activeKind = visibleCommands.some(
		(command) => command.kind === selectedKind,
	)
		? selectedKind
		: visibleCommands[0]?.kind;
	const activeTemplateId = visibleTemplates.some(
		(choice) => choice.id === selectedTemplateId,
	)
		? selectedTemplateId
		: visibleTemplates[0]?.id;

	const closeMenu = useCallback(() => {
		setMode("commands");
		setTemplateSearch("");
		setSelectedTemplateId("");
		setLoadedTemplateChoices(null);
		setToken(null);
		setPosition(null);
	}, []);

	const openTemplatePicker = useCallback(async () => {
		setMode("templates");
		setTemplateSearch("");
		setSelectedTemplateId(templateChoices[0]?.id ?? "");
		queueMicrotask(() => templateInputRef.current?.focus());
		if (!loadTemplateChoices) return;
		await loadTemplateChoices().then(
			(choices) => {
				setLoadedTemplateChoices(choices);
				setSelectedTemplateId(choices[0]?.id ?? "");
			},
			() => undefined,
		);
	}, [loadTemplateChoices, templateChoices]);

	const selectCommand = useCallback(
		(command: SlashCommand) => {
			if (!editor || !token) return;
			if (command.kind === "template") {
				void openTemplatePicker();
				return;
			}
			applySlashCommand(editor, token, command.kind);
			suppressedFromRef.current = null;
			closeMenu();
		},
		[closeMenu, editor, openTemplatePicker, token],
	);

	const selectTemplate = useCallback(
		(choice: SlashTemplateChoice) => {
			if (!onSelectTemplate || !token) return;
			onSelectTemplate(choice, token);
			suppressedFromRef.current = null;
			closeMenu();
		},
		[closeMenu, onSelectTemplate, token],
	);

	useEffect(() => {
		if (!editor) return;
		const viewport = viewportRef.current;

		// The query lives in ProseMirror text, not in the cmdk input. Recompute
		// the token and anchor whenever the editor may have moved.
		const update = () => {
			if (mode === "templates") return;
			const nextToken = findSlashToken(editor);
			if (!nextToken) {
				suppressedFromRef.current = null;
				positionedFromRef.current = null;
				closeMenu();
				return;
			}
			if (suppressedFromRef.current === nextToken.from) {
				positionedFromRef.current = null;
				closeMenu();
				return;
			}
			if (positionedFromRef.current !== nextToken.from) {
				positionedFromRef.current = nextToken.from;
				setPosition(null);
			}
			setToken(nextToken);
		};

		update();
		editor.on("transaction", update);
		editor.on("selectionUpdate", update);
		editor.on("focus", update);
		editor.on("blur", update);
		viewport?.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);

		return () => {
			editor.off("transaction", update);
			editor.off("selectionUpdate", update);
			editor.off("focus", update);
			editor.off("blur", update);
			viewport?.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, [closeMenu, editor, mode, viewportRef]);

	useCommandMenuPosition({
		editor,
		floatingRef: menuRef,
		pos: token?.from ?? null,
		setPosition,
		viewportRef,
	});

	useEffect(() => {
		menuRef.current
			?.querySelector(`[cmdk-item][data-value="${activeKind}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeKind]);

	useEffect(() => {
		menuRef.current
			?.querySelector(`[cmdk-item][data-value="${activeTemplateId}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeTemplateId]);

	useEffect(() => {
		if (!editor) return;

		// Keep focus in the editor so typing continues to update the document;
		// the menu only handles navigation and command selection keys.
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!token || mode === "templates") return;
			if (event.key === "Escape") {
				event.preventDefault();
				suppressedFromRef.current = token.from;
				closeMenu();
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const currentIndex = visibleCommands.findIndex(
					(command) => command.kind === activeKind,
				);
				if (currentIndex === -1) return;
				const direction = event.key === "ArrowDown" ? 1 : -1;
				const nextIndex =
					(currentIndex + direction + visibleCommands.length) %
					visibleCommands.length;
				setSelectedKind(visibleCommands[nextIndex].kind);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				const selectedCommand = visibleCommands.find(
					(command) => command.kind === activeKind,
				);
				if (!selectedCommand) return;
				event.preventDefault();
				selectCommand(selectedCommand);
			}
		};

		editor.view.dom.addEventListener("keydown", handleKeyDown, true);
		return () =>
			editor.view.dom.removeEventListener("keydown", handleKeyDown, true);
	}, [
		activeKind,
		closeMenu,
		editor,
		mode,
		selectCommand,
		token,
		visibleCommands,
	]);

	if (
		!editor ||
		!token ||
		(mode === "commands" && visibleCommands.length === 0) ||
		(mode === "templates" && availableTemplateChoices.length === 0)
	) {
		return null;
	}

	return (
		<div
			ref={menuRef}
			className="absolute z-[4] w-[250px] max-h-[var(--command-menu-height)] max-w-[calc(100%-1rem)] overflow-hidden rounded-[var(--radius-popover)] border border-border bg-popover text-popover-foreground shadow-overlay"
			style={{
				insetInlineStart: `${position?.x ?? 0}px`,
				insetBlockStart: `${position?.y ?? 0}px`,
				visibility: position ? "visible" : "hidden",
			}}
		>
			{mode === "commands" ? (
				<Command
					className="flex max-h-[var(--command-menu-height)] flex-col"
					label="Slash commands"
					value={activeKind}
					onValueChange={(value) => setSelectedKind(value as SlashMenuKind)}
					shouldFilter={false}
					loop
					onMouseDown={(event) => event.preventDefault()}
				>
					<Command.Input
						value={token.query}
						readOnly
						className="sr-only"
						aria-hidden="true"
						tabIndex={-1}
					/>
					<Command.List className="min-h-0 max-h-64 overflow-y-auto p-1">
						{visibleCommands.map((command) => {
							const Icon = command.icon;
							return (
								<Command.Item
									key={command.kind}
									value={command.kind}
									keywords={[
										command.title,
										command.description,
										...command.aliases,
									]}
									onSelect={() => selectCommand(command)}
									className={cn(
										"flex min-w-0 cursor-default items-center gap-2 rounded-[var(--radius-inner)] px-2 py-1.5 text-start text-[11px] leading-[15px] outline-hidden",
										"data-[selected=true]:bg-accent data-[selected=true]:text-foreground",
									)}
								>
									<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
										<Icon className="size-3.5" />
									</span>
									<span className="block min-w-0 flex-1 truncate text-foreground">
										{command.title}
									</span>
									{command.shortcut && (
										<span
											className="shrink-0 text-[10px] leading-none text-muted-foreground/60"
											aria-hidden="true"
										>
											{formatCommandShortcut(command.shortcut)}
										</span>
									)}
								</Command.Item>
							);
						})}
					</Command.List>
				</Command>
			) : (
				<Command
					className="flex max-h-[var(--command-menu-height)] flex-col"
					label="Templates"
					value={activeTemplateId}
					onValueChange={setSelectedTemplateId}
					shouldFilter={false}
					loop
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							setMode("commands");
							queueMicrotask(() => editor.view.focus());
						}
					}}
				>
					<Command.Input
						ref={templateInputRef}
						value={templateSearch}
						onValueChange={setTemplateSearch}
						placeholder="Search templates..."
						className="h-8 border-border border-b bg-transparent px-2 text-[12px] outline-none placeholder:text-muted-foreground"
					/>
					<Command.List className="min-h-0 max-h-64 overflow-y-auto p-1">
						{visibleTemplates.map((choice) => (
							<Command.Item
								key={choice.id}
								value={choice.id}
								keywords={[
									choice.title,
									choice.description ?? "",
									choice.library ?? "",
									choice.path ?? "",
									...(choice.keywords ?? []),
								]}
								onSelect={() => selectTemplate(choice)}
								className={cn(
									"flex min-w-0 cursor-default items-center gap-2 rounded-[var(--radius-inner)] px-2 py-1.5 text-start text-[11px] leading-[15px] outline-hidden",
									"data-[selected=true]:bg-accent data-[selected=true]:text-foreground",
								)}
							>
								<span className="block min-w-0 flex-1">
									<span className="flex min-w-0 items-center gap-1.5">
										<span className="truncate text-foreground">
											{choice.title}
										</span>
										{choice.isDefault && (
											<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase leading-none text-muted-foreground">
												Default
											</span>
										)}
									</span>
									{(choice.description || choice.library) && (
										<span className="block truncate text-muted-foreground">
											{[choice.description, choice.library]
												.filter(Boolean)
												.join(" · ")}
										</span>
									)}
								</span>
							</Command.Item>
						))}
						{visibleTemplates.length === 0 && (
							<Command.Empty className="px-2 py-3 text-[11px] text-muted-foreground">
								No templates found
							</Command.Empty>
						)}
					</Command.List>
				</Command>
			)}
		</div>
	);
}

function isInlineCommand(command: SlashCommand) {
	return (
		command.kind !== "template" &&
		INLINE_COMMANDS.has(command.kind as SlashCommandKind)
	);
}

function matchesCommand(command: SlashCommand, query: string) {
	if (query.trim() === "") return true;
	return (
		commandScore(command.kind, query, [
			command.title,
			command.description,
			...command.aliases,
		]) > 0
	);
}

function commandScore(value: string, search: string, keywords: string[]) {
	const normalizedSearch = normalize(search);
	if (!normalizedSearch) return 1;
	const haystacks = [value, ...keywords].map(normalize);
	let best = 0;
	for (const haystack of haystacks) {
		if (haystack === normalizedSearch) best = Math.max(best, 1);
		else if (haystack.startsWith(normalizedSearch)) best = Math.max(best, 0.9);
		else if (haystack.includes(normalizedSearch)) best = Math.max(best, 0.75);
		else if (isSubsequence(normalizedSearch, haystack)) {
			best = Math.max(best, 0.45);
		}
	}
	return best;
}

function templateChoiceScore(choice: SlashTemplateChoice, search: string) {
	return commandScore(choice.id, search, [
		choice.title,
		choice.description ?? "",
		choice.library ?? "",
		choice.path ?? "",
		...(choice.keywords ?? []),
	]);
}

function normalize(value: string) {
	return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function isSubsequence(needle: string, haystack: string) {
	let index = 0;
	for (const char of haystack) {
		if (char === needle[index]) index++;
		if (index === needle.length) return true;
	}
	return false;
}
