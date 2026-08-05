import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import { keymatch } from "keymatch";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import MingcuteCornerDownLeftLine from "~icons/mingcute/corner-down-left-line";
import MingcuteFileLine from "~icons/mingcute/file-line";
import MingcuteSearch2Line from "~icons/mingcute/search-2-line";
import { type MatchRange, matchRanges, scorePath } from "../lib/fuzzy";
import {
	COMMAND_PREFIX,
	groupCommands,
	isCommandQuery,
	OPEN_COMMAND_PALETTE_EVENT,
	type PaletteCommand,
	rankCommands,
	rankSearchCommands,
	stripCommandPrefix,
} from "../lib/paletteCommand";
import { formatShortcut } from "../lib/shortcut";

const SEARCH_DEBOUNCE_MS = 150;
const MIN_CONTENT_QUERY_LENGTH = 3;
const MAX_NAME_RESULTS = 50;
const MAX_RECENT_FILES = 20;

export type PaletteFile = {
	path: string;
	relativePath: string;
	modifiedAt: number;
};

export type PaletteContentMatch = {
	line: number;
	excerpt: string;
	matchStart: number;
	matchEnd: number;
};

export type PaletteFileMatches = {
	path: string;
	matches: PaletteContentMatch[];
};

export type PaletteContentResult = {
	results: PaletteFileMatches[];
	truncated: boolean;
};

export type GlobalSearchPaletteProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	files: PaletteFile[];
	onSelectFile: (path: string) => void;
	searchContents: (query: string) => Promise<PaletteContentResult>;
	/** Runnable commands, already filtered to those enabled in this context. */
	commands?: PaletteCommand[];
	/** Most-recently-run command ids first; used only to break ranking ties. */
	recentCommandIds?: string[];
	onRunCommand?: (id: string) => void;
};

function Highlight({ text, ranges }: { text: string; ranges: MatchRange[] }) {
	if (ranges.length === 0) return <>{text}</>;
	const parts: React.ReactNode[] = [];
	let cursor = 0;
	for (const [start, end] of ranges) {
		if (start > cursor) parts.push(text.slice(cursor, start));
		parts.push(
			<mark
				key={`${start}-${end}`}
				className="rounded-[2px] bg-selected/30 font-semibold text-foreground"
			>
				{text.slice(start, end)}
			</mark>,
		);
		cursor = end;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return <>{parts}</>;
}

function fileName(relativePath: string) {
	const slash = relativePath.lastIndexOf("/");
	return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

function folderPath(relativePath: string) {
	const slash = relativePath.lastIndexOf("/");
	return slash === -1 ? "" : relativePath.slice(0, slash);
}

function getNameResults(files: PaletteFile[], query: string) {
	if (query.trim() === "") {
		return [...files]
			.sort((a, b) => b.modifiedAt - a.modifiedAt)
			.slice(0, MAX_RECENT_FILES);
	}
	return files
		.map((file) => ({ file, score: scorePath(query, file.relativePath) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || b.file.modifiedAt - a.file.modifiedAt)
		.slice(0, MAX_NAME_RESULTS)
		.map((entry) => entry.file);
}

/**
 * Content search is debounced and runs behind the name results, which match
 * synchronously. A resolve for a query the user has already moved past is
 * dropped rather than rendered, so results never flicker backwards.
 */
function useContentResults(
	query: string,
	open: boolean,
	searchContents: GlobalSearchPaletteProps["searchContents"],
) {
	const [result, setResult] = useState<PaletteContentResult | null>(null);
	const [searching, setSearching] = useState(false);
	const searchRef = useRef(searchContents);

	useLayoutEffect(() => {
		searchRef.current = searchContents;
	}, [searchContents]);

	useEffect(() => {
		if (!open || query.trim().length < MIN_CONTENT_QUERY_LENGTH) {
			setResult(null);
			setSearching(false);
			return;
		}

		let cancelled = false;
		setSearching(true);
		const timer = setTimeout(() => {
			searchRef
				.current(query)
				.then((next) => {
					if (cancelled) return;
					setResult(next);
					setSearching(false);
				})
				.catch(() => {
					if (cancelled) return;
					setResult(null);
					setSearching(false);
				});
		}, SEARCH_DEBOUNCE_MS);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [open, query]);

	return { result, searching };
}

function GlobalSearchPalette({
	open,
	onOpenChange,
	files,
	onSelectFile,
	searchContents,
	commands = [],
	recentCommandIds = [],
	onRunCommand,
}: GlobalSearchPaletteProps) {
	const [query, setQuery] = useState("");
	// Mode is held rather than derived from the query, because the prefix is
	// promoted to a chip the moment it is typed and never becomes text. `query`
	// is always the search terms alone, in either mode.
	const [commandMode, setCommandMode] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const fileQuery = commandMode ? "" : query;
	const nameResults = commandMode ? [] : getNameResults(files, fileQuery);
	const { result, searching } = useContentResults(
		fileQuery,
		open && !commandMode,
		searchContents,
	);

	const rankedCommands = commandMode
		? rankCommands(query, commands, recentCommandIds)
		: rankSearchCommands(query, commands, recentCommandIds);
	const commandResults = commandMode ? groupCommands(rankedCommands) : [];
	const searchCommandResults = commandMode ? [] : rankedCommands;

	/** Typing the prefix into an empty query swaps the chip in, not the text. */
	const changeQuery = (next: string) => {
		if (!commandMode && isCommandQuery(next)) {
			setCommandMode(true);
			setQuery(stripCommandPrefix(next));
			return;
		}
		setQuery(next);
	};

	/**
	 * Backspace on an empty command query removes the chip.
	 *
	 * This keeps the chip feeling like the character it replaced: the same
	 * keystroke that used to delete a leading `/` still leaves command mode,
	 * so nobody has to discover a different way back to searching notes.
	 */
	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Backspace" && commandMode && query === "") {
			event.preventDefault();
			setCommandMode(false);
			return;
		}

		if (
			commands.some(
				(command) =>
					command.globalShortcut &&
					command.binding &&
					keymatch(event.nativeEvent, command.binding),
			)
		) {
			onOpenChange(false);
		}
	};

	useEffect(() => {
		if (!open) {
			setQuery("");
			setCommandMode(false);
		}
	}, [open]);

	useEffect(() => {
		const openCommands = () => {
			setQuery("");
			setCommandMode(true);
			onOpenChange(true);
		};
		window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommands);
		return () =>
			window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommands);
	}, [onOpenChange]);

	const relativeByPath = new Map(
		files.map((file) => [file.path, file.relativePath]),
	);
	const namePaths = new Set(nameResults.map((file) => file.path));
	// A file that already matched by name appears once, in the name group.
	const contentResults = (result?.results ?? []).filter(
		(entry) => !namePaths.has(entry.path),
	);

	const select = (path: string) => {
		onOpenChange(false);
		onSelectFile(path);
	};

	// Close before running: a command that opens another dialog or moves focus
	// would otherwise fight the palette's own closing focus restore.
	const runCommand = (command: PaletteCommand) => {
		onOpenChange(false);
		onRunCommand?.(command.id);
		void command.run();
	};

	const isEmptyQuery = fileQuery.trim() === "";
	const hasResults = commandMode
		? commandResults.length > 0
		: searchCommandResults.length > 0 ||
			nameResults.length > 0 ||
			contentResults.length > 0;
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				{/* base-ui keeps the popup mounted after close. Without
				    `data-[closed]:pointer-events-none` the invisible result list keeps
				    hit-testing, and a click in the middle of the editor silently opens
				    whichever file sat under the cursor. */}
				<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] opacity-100 transition-opacity duration-200 ease-snappy data-[closed]:pointer-events-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
				{/* `--popover` sits only 0.04 lightness above `--background` in dark
				    mode and `--shadow-overlay` is tuned for light backgrounds, so the
				    ring carries the elevation the shadow cannot.

				    `initialFocus` rather than `autoFocus` on the input: the popup stays
				    mounted after close, so `autoFocus` fires only on the first open and
				    a second Cmd+P would leave the caret in the editor. A manual focus()
				    call races base-ui's own focus management; this does not. */}
				<Dialog.Popup
					initialFocus={inputRef}
					className="fixed top-[12vh] left-1/2 z-50 flex max-h-[60vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 scale-100 flex-col overflow-hidden rounded-[var(--radius-popover)] bg-popover text-popover-foreground opacity-100 shadow-overlay ring-1 ring-black/10 outline-hidden transition-[translate,scale,opacity] duration-200 ease-snappy data-[closed]:pointer-events-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 dark:ring-white/15"
				>
					<Dialog.Title className="sr-only">
						{commandMode ? "Run a command" : "Search files"}
					</Dialog.Title>
					<Dialog.Description className="sr-only">
						{commandMode
							? "Run a Hubble command. Press Backspace on an empty query to search notes instead."
							: "Find notes and commands. Type a slash to browse all commands."}
					</Dialog.Description>
					<Command
						label={commandMode ? "Run a command" : "Search files"}
						shouldFilter={false}
						loop
						className="flex min-h-0 flex-1 flex-col"
					>
						<div className="flex items-center gap-2.5 border-b border-border px-3.5">
							{commandMode ? (
								<span className="flex size-4 -translate-y-0.5 shrink-0 items-center justify-center text-[13px] text-muted-foreground leading-none">
									{COMMAND_PREFIX}
								</span>
							) : (
								<MingcuteSearch2Line className="size-4 shrink-0 text-muted-foreground" />
							)}
							<Command.Input
								ref={inputRef}
								value={query}
								onValueChange={changeQuery}
								onKeyDown={handleKeyDown}
								placeholder={
									commandMode ? "Run a command" : "Search notes and commands"
								}
								className="h-12 w-full border-0 bg-transparent text-[13px] text-foreground outline-hidden placeholder:text-muted-foreground"
							/>
							{searching && (
								<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
									Searching…
								</span>
							)}
						</div>

						<Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
							{!hasResults && !searching && (
								<div className="px-3 py-8 text-center text-xs text-muted-foreground">
									{commandMode
										? "No commands"
										: isEmptyQuery
											? "No notes yet"
											: "No matches"}
								</div>
							)}

							{commandMode &&
								commandResults.map(({ group, commands: groupItems }) => (
									<ResultGroup key={group} heading={group}>
										{groupItems.map((command) => (
											<Command.Item
												key={command.id}
												value={`command:${command.id}`}
												onSelect={() => runCommand(command)}
												className={ROW_CLASS}
											>
												<CommandRow
													command={command}
													query={stripCommandPrefix(query)}
												/>
											</Command.Item>
										))}
									</ResultGroup>
								))}

							{!commandMode && searchCommandResults.length > 0 && (
								<ResultGroup heading="Commands">
									{searchCommandResults.map((command) => (
										<Command.Item
											key={command.id}
											value={`command:${command.id}`}
											onSelect={() => runCommand(command)}
											className={ROW_CLASS}
										>
											<CommandRow command={command} query={query} />
										</Command.Item>
									))}
								</ResultGroup>
							)}

							{!commandMode && nameResults.length > 0 && (
								<ResultGroup heading={isEmptyQuery ? "Recent" : "Notes"}>
									{nameResults.map((file) => (
										<Command.Item
											key={file.path}
											value={`name:${file.path}`}
											onSelect={() => select(file.path)}
											className={ROW_CLASS}
										>
											<FileRow
												relativePath={file.relativePath}
												query={isEmptyQuery ? "" : query}
											/>
										</Command.Item>
									))}
								</ResultGroup>
							)}

							{!commandMode && contentResults.length > 0 && (
								<ResultGroup heading="Content">
									{contentResults.map((entry) => {
										const relativePath =
											relativeByPath.get(entry.path) ?? entry.path;
										return (
											<Command.Item
												key={entry.path}
												value={`content:${entry.path}`}
												onSelect={() => select(entry.path)}
												className={ROW_CLASS}
											>
												<FileRow relativePath={relativePath} query="" />
												<div className="mt-1 flex flex-col gap-0.5 ps-[calc(0.875rem+0.625rem)]">
													{entry.matches.map((match) => (
														<span
															key={`${entry.path}:${match.line}`}
															className="block truncate text-[11px] leading-[16px] text-muted-foreground"
														>
															<Highlight
																text={match.excerpt}
																ranges={[[match.matchStart, match.matchEnd]]}
															/>
														</span>
													))}
												</div>
											</Command.Item>
										);
									})}
								</ResultGroup>
							)}

							{result?.truncated && (
								<p className="m-0 px-3 py-2 text-[11px] text-muted-foreground">
									Some content matches aren't shown. Narrow your search.
								</p>
							)}
						</Command.List>

						<div className="flex shrink-0 items-center gap-3 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
							<span className="flex items-center gap-3">
								<Legend keys="↑↓">Navigate</Legend>
								<Legend
									icon={<MingcuteCornerDownLeftLine className="size-3" />}
								>
									{commandMode ? "Run" : "Open"}
								</Legend>
								<Legend keys="esc">Close</Legend>
							</span>
							{commands.length > 0 && (commandMode || query === "") && (
								<span className="ms-auto flex items-center gap-1.5">
									<kbd className="flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-inner)] border border-border px-1 font-sans text-[10px] leading-none text-muted-foreground">
										{commandMode ? formatShortcut("Backspace") : COMMAND_PREFIX}
									</kbd>
									{commandMode ? "Search notes" : "All commands"}
								</span>
							)}
						</div>
					</Command>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

const ROW_CLASS =
	"flex cursor-pointer flex-col rounded-[var(--radius-row)] px-2.5 py-1.5 outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-foreground";

function ResultGroup({
	heading,
	children,
}: {
	heading: string;
	children: React.ReactNode;
}) {
	return (
		<Command.Group
			heading={heading}
			className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
		>
			{children}
		</Command.Group>
	);
}

/** File name with its folder trailing, matched characters emphasized. */
function FileRow({
	relativePath,
	query,
}: {
	relativePath: string;
	query: string;
}) {
	const name = fileName(relativePath);
	const folder = folderPath(relativePath);
	const nameRanges = query ? matchRanges(query, name) : [];
	// A file can rank purely on its folder ("me" finding meetings/retro.md). With
	// nothing emphasized such a row reads as a false positive, so when the name
	// holds no match, show where in the folder the query actually landed.
	const folderRanges =
		query && folder && nameRanges.length === 0
			? matchRanges(query, folder)
			: [];

	return (
		<span className="flex min-w-0 items-center gap-2.5">
			<MingcuteFileLine className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
				<Highlight text={name} ranges={nameRanges} />
			</span>
			{folder && (
				<span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">
					<Highlight text={folder} ranges={folderRanges} />
				</span>
			)}
		</span>
	);
}

/** Command label with its shortcut trailing, matched characters emphasized. */
function CommandRow({
	command,
	query,
}: {
	command: PaletteCommand;
	query: string;
}) {
	const ranges = query ? matchRanges(query, command.label) : [];

	return (
		<span className="flex min-w-0 items-center gap-2.5">
			<span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
				<Highlight text={command.label} ranges={ranges} />
			</span>
			{command.shortcut && (
				<kbd className="shrink-0 rounded-[var(--radius-inner)] border border-border px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground">
					{command.shortcut}
				</kbd>
			)}
		</span>
	);
}

function Legend({
	keys,
	icon,
	children,
}: {
	keys?: string;
	icon?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<span className="flex items-center gap-1">
			<kbd className="flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-inner)] border border-border px-1 font-sans text-[10px] leading-none text-muted-foreground">
				{icon ?? keys}
			</kbd>
			{children}
		</span>
	);
}

export { GlobalSearchPalette };
