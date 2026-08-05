import { scoreText } from "./fuzzy";

/**
 * A runnable action shown in the palette's command mode.
 *
 * `label`, `group`, and `shortcut` are display-only; `run` is what the palette
 * invokes. Commands are supplied by the host app rather than defined here so
 * this package stays free of desktop-specific actions.
 *
 * Once the command registry (#193) lands, a `PaletteCommand` becomes a
 * projection of a registry entry: `id`, `label`, and `shortcut` read straight
 * from it, `run` comes from the shared handler map, and enablement is applied
 * by the caller before the list reaches this component.
 */
export type PaletteCommand = {
	id: string;
	label: string;
	group: string;
	/** Search synonyms, so "theme" finds "Toggle Dark Mode". */
	keywords?: string[];
	/** Destructive commands require explicit slash-mode intent. */
	destructive?: boolean;
	/** The host handles this shortcut even while the palette input has focus. */
	globalShortcut?: boolean;
	/** Raw shortcut used to dismiss the palette before the host handles it. */
	binding?: string;
	/** Shortcut formatted for display via `formatShortcut`. */
	shortcut?: string;
	run: () => void | Promise<void>;
};

/**
 * Ranks a command against a query.
 *
 * The label carries full weight. Keywords and the group name are discounted so
 * a direct label hit always outranks a synonym: for the query "new", "New
 * Note" beats a File-group command that merely happens to list "new" as a
 * keyword. Keywords are scored individually rather than as one joined string,
 * otherwise a subsequence could span two unrelated synonyms and score a match
 * that reads as a false positive.
 */
export function scoreCommand(query: string, command: PaletteCommand): number {
	const label = scoreText(query, command.label);
	const keyword = Math.max(
		0,
		...(command.keywords ?? []).map((word) => scoreText(query, word)),
	);
	const group = scoreText(query, command.group);
	return Math.max(label, 0.7 * keyword, 0.5 * group);
}

/**
 * Filters and orders commands for a query.
 *
 * `recentIds` is most-recently-run first and only breaks ties between equal
 * scores, so frecency makes the list feel learned without ever floating a
 * weaker text match above a stronger one. On an empty query every command
 * scores 1, which collapses the ordering to pure recency — the Raycast
 * behavior where the palette opens already showing what you last did.
 */
export function rankCommands(
	query: string,
	commands: PaletteCommand[],
	recentIds: string[] = [],
): PaletteCommand[] {
	const recency = new Map(recentIds.map((id, index) => [id, index]));
	const rank = (command: PaletteCommand) =>
		recency.get(command.id) ?? Number.MAX_SAFE_INTEGER;

	return commands
		.map((command) => ({ command, score: scoreCommand(query, command) }))
		.filter((entry) => entry.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				rank(a.command) - rank(b.command) ||
				a.command.label.localeCompare(b.command.label),
		)
		.map((entry) => entry.command);
}

const MIN_SEARCH_COMMAND_SCORE = 0.63;
const MAX_SEARCH_COMMANDS = 3;

/** Strong, safe command matches shown alongside note search results. */
export function rankSearchCommands(
	query: string,
	commands: PaletteCommand[],
	recentIds: string[] = [],
): PaletteCommand[] {
	const trimmed = query.trim();
	if (trimmed.replace(/[\s_-]+/g, "").length < 2) return [];

	return rankCommands(
		trimmed,
		commands.filter((command) => !command.destructive),
		recentIds,
	)
		.filter(
			(command) => scoreCommand(trimmed, command) >= MIN_SEARCH_COMMAND_SCORE,
		)
		.slice(0, MAX_SEARCH_COMMANDS);
}

/**
 * Groups ranked commands while preserving rank order.
 *
 * A group takes the position of its best-scoring member, so the group holding
 * the top hit renders first instead of the list snapping back to a fixed
 * category order and burying what the user actually typed.
 */
export function groupCommands(
	commands: PaletteCommand[],
): { group: string; commands: PaletteCommand[] }[] {
	const groups = new Map<string, PaletteCommand[]>();
	for (const command of commands) {
		const existing = groups.get(command.group);
		if (existing) existing.push(command);
		else groups.set(command.group, [command]);
	}
	return [...groups].map(([group, items]) => ({ group, commands: items }));
}

const COMMAND_PREFIX = "/";
const OPEN_COMMAND_PALETTE_EVENT = "hubble:open-command-palette";

/**
 * Command mode is entered by a leading `/`, matching the editor's own slash
 * menu so one key means "give me a list of things to run" everywhere in Hubble.
 */
export function isCommandQuery(query: string): boolean {
	return query.startsWith(COMMAND_PREFIX);
}

export function stripCommandPrefix(query: string): string {
	return isCommandQuery(query) ? query.slice(COMMAND_PREFIX.length) : query;
}

export { COMMAND_PREFIX, OPEN_COMMAND_PALETTE_EVENT };
