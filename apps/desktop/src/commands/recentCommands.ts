import { store } from "@simplestack/store";
import { localStoragePersist } from "../lib/localStoragePersist";

const STORAGE_KEY = "hubble-desktop-recent-commands";
const MAX_RECENT = 40;

function loadRecentCommands(): string[] {
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

export const recentCommandIdsStore = store<string[]>(loadRecentCommands(), {
	middleware: [localStoragePersist(STORAGE_KEY)],
});

export function recordRecentCommand(id: string) {
	recentCommandIdsStore.set((current) =>
		[id, ...current.filter((existing) => existing !== id)].slice(0, MAX_RECENT),
	);
}

export { STORAGE_KEY as RECENT_COMMANDS_STORAGE_KEY };
