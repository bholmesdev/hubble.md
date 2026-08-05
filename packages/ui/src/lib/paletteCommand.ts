import { scoreText } from "./fuzzy";

export type PaletteCommand = {
	id: string;
	label: string;
	group: string;
	keywords?: string[];
	globalShortcut?: boolean;
	binding?: string;
	shortcut?: string;
	run: () => void | Promise<void>;
};

export function scoreCommand(query: string, command: PaletteCommand): number {
	// Prefer labels, then synonyms, then group names.
	const label = scoreText(query, command.label);
	const keyword = Math.max(
		0,
		...(command.keywords ?? []).map((word) => scoreText(query, word)),
	);
	const group = scoreText(query, command.group);
	return Math.max(label, 0.7 * keyword, 0.5 * group);
}

export function rankCommands(
	query: string,
	commands: PaletteCommand[],
	recentIds: string[] = [],
): PaletteCommand[] {
	const recency = new Map(recentIds.map((id, index) => [id, index]));
	const recentRank = (command: PaletteCommand) =>
		recency.get(command.id) ?? Number.MAX_SAFE_INTEGER;

	return commands
		.map((command) => ({ command, score: scoreCommand(query, command) }))
		.filter((entry) => entry.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				recentRank(a.command) - recentRank(b.command) ||
				a.command.label.localeCompare(b.command.label),
		)
		.map((entry) => entry.command);
}

const MIN_SEARCH_COMMAND_SCORE = 0.63;
const MAX_SEARCH_COMMANDS = 3;

export function rankSearchCommands(
	query: string,
	commands: PaletteCommand[],
	recentIds: string[] = [],
): PaletteCommand[] {
	const trimmed = query.trim();
	if (trimmed.replace(/[\s_-]+/g, "").length < 2) return [];

	return rankCommands(trimmed, commands, recentIds)
		.filter(
			(command) => scoreCommand(trimmed, command) >= MIN_SEARCH_COMMAND_SCORE,
		)
		.slice(0, MAX_SEARCH_COMMANDS);
}

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

export function isCommandQuery(query: string): boolean {
	return query.startsWith(COMMAND_PREFIX);
}

export function stripCommandPrefix(query: string): string {
	return isCommandQuery(query) ? query.slice(COMMAND_PREFIX.length) : query;
}

export { COMMAND_PREFIX, OPEN_COMMAND_PALETTE_EVENT };
