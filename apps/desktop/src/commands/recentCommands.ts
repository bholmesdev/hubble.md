const STORAGE_KEY = "hubble-desktop-recent-commands";
const MAX_RECENT = 40;

/**
 * Most-recently-run command ids, newest first.
 *
 * Kept in its own storage key rather than in the app store: this is palette
 * ranking state, not app state, and nothing outside the palette reads it. When
 * the command registry lands it can move alongside the shortcut preferences
 * (#194) without changing the shape stored here.
 *
 * A plain recency list rather than a decayed frequency score. Recency alone
 * already produces the "the palette learned my habits" feel, and it cannot
 * develop the stuck-favorite problem where an early burst of use pins a
 * command to the top long after the user stopped reaching for it.
 */
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

/** Returns the next list so callers can update React state from the result. */
export function recordRecentCommand(id: string, current: string[]): string[] {
	const next = [id, ...current.filter((existing) => existing !== id)].slice(
		0,
		MAX_RECENT,
	);
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			// A full or unavailable localStorage costs ranking quality, nothing more.
		}
	}
	return next;
}

export { STORAGE_KEY as RECENT_COMMANDS_STORAGE_KEY };
