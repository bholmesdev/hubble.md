const STORAGE_KEY = "hubble-desktop-recent-commands";
const MAX_RECENT = 40;

export function loadRecentCommands(): string[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is string => typeof id === "string");
	} catch {
		return [];
	}
}

export function recordRecentCommand(id: string, current: string[]): string[] {
	const next = [id, ...current.filter((existing) => existing !== id)].slice(
		0,
		MAX_RECENT,
	);
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Recency is optional.
		}
	}
	return next;
}

export { STORAGE_KEY as RECENT_COMMANDS_STORAGE_KEY };
