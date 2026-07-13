import type { Editor } from "@tiptap/core";
import { Command } from "cmdk";
import { keymatch } from "keymatch";
import {
	type ComponentType,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteBoldLine from "~icons/mingcute/bold-line";
import MingcuteBorderHorizontalLine from "~icons/mingcute/border-horizontal-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteHeading1Line from "~icons/mingcute/heading-1-line";
import MingcuteHeading2Line from "~icons/mingcute/heading-2-line";
import MingcuteHeading3Line from "~icons/mingcute/heading-3-line";
import MingcuteItalicLine from "~icons/mingcute/italic-line";
import MingcuteLinkLine from "~icons/mingcute/link-line";
import MingcuteListCheck2Line from "~icons/mingcute/list-check-2-line";
import MingcuteListCheckLine from "~icons/mingcute/list-check-line";
import MingcuteListOrderedLine from "~icons/mingcute/list-ordered-line";
import MingcuteQuoteLeftLine from "~icons/mingcute/quote-left-line";
import MingcuteStrikethroughLine from "~icons/mingcute/strikethrough-line";
import MingcuteTextLine from "~icons/mingcute/text-line";
import { formatShortcut } from "../lib/shortcut";
import { cn } from "../lib/utils";
import { useCommandMenuPosition } from "./commandMenuPosition";
import {
	applyFormatCommand,
	type FormatCommandKind,
	isFormatActive,
} from "./formatCommands";

/** Opens the `Cmd+/` format command menu from elsewhere (e.g. the selection toolbar's "More" button). */
export const OPEN_FORMAT_COMMAND_MENU_EVENT = "hubble:open-format-command-menu";

type FormatCommand = {
	kind: FormatCommandKind;
	title: string;
	description: string;
	aliases: string[];
	icon: ComponentType<{ className?: string }>;
	group: "Block" | "Inline";
	// Platform-agnostic accelerator spec (e.g. "CmdOrCtrl+Shift+8"), rendered
	// per-platform via formatShortcut. Omit when the command has no shortcut.
	shortcut?: string;
};

type MenuPosition = {
	x: number;
	y: number;
};

const FORMAT_COMMANDS: FormatCommand[] = [
	{
		kind: "paragraph",
		title: "Text",
		description: "Convert to plain text",
		aliases: ["paragraph", "plain"],
		icon: MingcuteTextLine,
		group: "Block",
	},
	{
		kind: "heading1",
		title: "Heading 1",
		description: "Convert to large heading",
		aliases: ["h1", "#", "title"],
		icon: MingcuteHeading1Line,
		group: "Block",
	},
	{
		kind: "heading2",
		title: "Heading 2",
		description: "Convert to medium heading",
		aliases: ["h2", "##", "subtitle"],
		icon: MingcuteHeading2Line,
		group: "Block",
	},
	{
		kind: "heading3",
		title: "Heading 3",
		description: "Convert to small heading",
		aliases: ["h3", "###"],
		icon: MingcuteHeading3Line,
		group: "Block",
	},
	{
		kind: "bulletList",
		title: "Bulleted list",
		description: "Convert to bulleted list",
		aliases: ["bullet", "bullets", "ul", "list"],
		icon: MingcuteListCheckLine,
		group: "Block",
		shortcut: "CmdOrCtrl+Shift+8",
	},
	{
		kind: "orderedList",
		title: "Numbered list",
		description: "Convert to numbered list",
		aliases: ["number", "numbered", "ol", "1."],
		icon: MingcuteListOrderedLine,
		group: "Block",
		shortcut: "CmdOrCtrl+Shift+7",
	},
	{
		kind: "taskList",
		title: "To-do list",
		description: "Convert to task list",
		aliases: ["todo", "task", "check", "checkbox"],
		icon: MingcuteListCheck2Line,
		group: "Block",
		shortcut: "CmdOrCtrl+Shift+9",
	},
	{
		kind: "blockquote",
		title: "Quote",
		description: "Convert to quote",
		aliases: ["blockquote", ">"],
		icon: MingcuteQuoteLeftLine,
		group: "Block",
	},
	{
		kind: "divider",
		title: "Divider",
		description: "Insert a divider",
		aliases: ["hr", "horizontal", "rule", "separator", "---"],
		icon: MingcuteBorderHorizontalLine,
		group: "Block",
	},
	{
		kind: "bold",
		title: "Bold",
		description: "Toggle bold",
		aliases: ["strong", "b"],
		icon: MingcuteBoldLine,
		group: "Inline",
		shortcut: "CmdOrCtrl+B",
	},
	{
		kind: "italic",
		title: "Italic",
		description: "Toggle italic",
		aliases: ["emphasis", "i"],
		icon: MingcuteItalicLine,
		group: "Inline",
		shortcut: "CmdOrCtrl+I",
	},
	{
		kind: "strike",
		title: "Strikethrough",
		description: "Toggle strikethrough",
		aliases: ["strike", "s", "delete"],
		icon: MingcuteStrikethroughLine,
		group: "Inline",
		shortcut: "CmdOrCtrl+Shift+X",
	},
	{
		kind: "link",
		title: "Link",
		description: "Add or remove link",
		aliases: ["url", "href", "wiki"],
		icon: MingcuteLinkLine,
		group: "Inline",
		shortcut: "CmdOrCtrl+K",
	},
];

export function FormatCommandMenu({
	editor,
	viewportRef,
}: {
	editor: Editor | null;
	viewportRef: RefObject<HTMLDivElement | null>;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [position, setPosition] = useState<MenuPosition | null>(null);
	const [selectedKind, setSelectedKind] =
		useState<FormatCommandKind>("paragraph");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const visibleCommands = FORMAT_COMMANDS.filter((command) =>
		matchesCommand(command, query),
	);
	const activeKind = visibleCommands.some(
		(command) => command.kind === selectedKind,
	)
		? selectedKind
		: visibleCommands[0]?.kind;
	const closeMenu = () => {
		setOpen(false);
		setQuery("");
		setPosition(null);
		// Drop the frozen highlight and restore the real selection so a chosen
		// command formats the range the user was looking at.
		editor?.commands.restoreSelection({ focus: false });
	};
	const openMenu = () => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		// Focus moves to the menu input, which visually drops the editor
		// selection. Freeze it as a decoration so the user can still see what
		// they are about to format.
		editor?.commands.freezeSelection();
		setQuery("");
		setSelectedKind("paragraph");
		setPosition(null);
		setOpen(true);
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	useEffect(
		() => {
			if (!editor) return;

			const handleKeyDown = (event: KeyboardEvent) => {
				if (!keymatch(event, "CmdOrCtrl+/")) return;
				if (!editor.isFocused && !open) return;
				event.preventDefault();
				if (open) {
					closeMenu();
					return;
				}
				openMenu();
			};

			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
		[closeMenu, editor, open, openMenu],
	);

	useEffect(
		() => {
			if (!editor) return;
			const handleOpenRequest = () => openMenu();
			window.addEventListener(
				OPEN_FORMAT_COMMAND_MENU_EVENT,
				handleOpenRequest,
			);
			return () =>
				window.removeEventListener(
					OPEN_FORMAT_COMMAND_MENU_EVENT,
					handleOpenRequest,
				);
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes the render-local callback.
		[editor, openMenu],
	);

	useCommandMenuPosition({
		editor,
		floatingRef: menuRef,
		pos: open ? (editor?.state.selection.from ?? null) : null,
		setPosition,
		viewportRef,
	});

	if (!editor || !open) return null;

	const runCommand = (kind: FormatCommandKind) => {
		closeMenu();
		applyFormatCommand(editor, kind);
	};

	return (
		<div
			ref={menuRef}
			className="absolute z-[5] w-[250px] overflow-hidden rounded-[var(--radius-popover)] border border-border bg-popover text-popover-foreground shadow-overlay"
			style={{
				insetInlineStart: `${position?.x ?? 0}px`,
				insetBlockStart: `${position?.y ?? 0}px`,
				visibility: position ? "visible" : "hidden",
			}}
		>
			<Command
				label="Format commands"
				value={activeKind}
				onValueChange={(value) => setSelectedKind(value as FormatCommandKind)}
				shouldFilter={false}
				loop
			>
				<Command.Input
					ref={inputRef}
					value={query}
					onValueChange={setQuery}
					placeholder="Format..."
					className="h-8 w-full border-0 border-b border-border bg-background px-2 text-[11px] leading-[16px] text-foreground outline-hidden placeholder:text-muted-foreground"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							closeMenu();
							editor.commands.focus(undefined, { scrollIntoView: false });
						}
					}}
				/>
				<Command.List className="max-h-64 overflow-y-auto p-1">
					{visibleCommands.length === 0 ? (
						<div className="px-2 py-2 text-[11px] text-muted-foreground">
							No commands
						</div>
					) : (
						<>
							{renderGroup("Block", visibleCommands, runCommand, editor)}
							{renderGroup("Inline", visibleCommands, runCommand, editor)}
						</>
					)}
				</Command.List>
			</Command>
		</div>
	);
}

function renderGroup(
	group: FormatCommand["group"],
	commands: FormatCommand[],
	runCommand: (kind: FormatCommandKind) => void,
	editor: Editor,
) {
	const groupCommands = commands.filter((command) => command.group === group);
	if (groupCommands.length === 0) return null;

	return (
		<Command.Group
			key={group}
			heading={group}
			className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:leading-[13px] [&_[cmdk-group-heading]]:text-muted-foreground"
		>
			{groupCommands.map((command) => {
				const Icon = command.icon;
				const isApplied = isFormatActive(editor, command.kind);
				return (
					<Command.Item
						key={command.kind}
						value={command.kind}
						keywords={[command.title, command.description, ...command.aliases]}
						onMouseDown={(event) => event.preventDefault()}
						onSelect={() => runCommand(command.kind)}
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
						{isApplied ? (
							<MingcuteCheckLine className="size-3.5 shrink-0 text-muted-foreground" />
						) : command.shortcut ? (
							<span
								className="shrink-0 text-[10px] leading-none text-muted-foreground/60"
								aria-hidden="true"
							>
								{formatShortcut(command.shortcut)}
							</span>
						) : null}
					</Command.Item>
				);
			})}
		</Command.Group>
	);
}

function matchesCommand(command: FormatCommand, query: string) {
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
