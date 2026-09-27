import { type CommandBindings, cleanCommandBindings } from "@hubble.md/editor";
import { z } from "zod";
import type { ThemePreference } from "../theme";
import { DEFAULT_CHAT_COMMAND } from "./settings";
import {
	emptyDoc,
	type FileEntry,
	type FolderEntry,
	type SortMode,
} from "./state";
import {
	MAX_CLOSED_TABS,
	type TabSession,
	type TabsState,
	tabSession,
	tabsFromSession,
} from "./tabs";

type WorkspaceState = {
	workspacePath: string | null;
	recentWorkspaces: string[];
	sortMode: SortMode;
	files: FileEntry[];
	folders: FolderEntry[];
	pinnedNotes: string[];
};

type DocumentState = ReturnType<typeof emptyDoc>;

export type TerminalPosition = "bottom" | "right";

type UiState = {
	sidebarOpen: boolean;
	isSwitcherOpen: boolean;
	isTerminalOpen: boolean;
	terminalPosition: TerminalPosition;
	pendingTerminalCommand: string | null;
};

type SettingsState = {
	chatCommand: string;
	codeFileOpenMode: CodeFileOpenMode;
	lastSeenVersion: string | null;
	shortcutBindings: CommandBindings;
	theme: ThemePreference;
};

export type CodeFileOpenMode = "hubble" | "default-app";

export type DesktopState = {
	workspace: WorkspaceState;
	document: DocumentState;
	tabs: TabsState;
	tabSessions: Record<string, TabSession>;
	ui: UiState;
	settings: SettingsState;
};

type Persisted = {
	tabSessions?: Record<string, TabSession>;
	workspace?: {
		workspacePath?: string | null;
		recentWorkspaces?: string[];
		sortMode?: SortMode;
	};
	ui?: {
		sidebarOpen?: boolean;
		isTerminalOpen?: boolean;
		terminalPosition?: TerminalPosition;
	};
	settings?: {
		chatCommand?: string;
		codeFileOpenMode?: CodeFileOpenMode;
		lastSeenVersion?: string | null;
		shortcutBindings?: unknown;
		theme?: ThemePreference;
	};
};

export const STORAGE_KEY = "hubble-desktop-app";

function readStorage<T>(key: string): T | null {
	if (typeof localStorage === "undefined") return null;

	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function hydrateWorkspace(ws: Persisted["workspace"]): WorkspaceState {
	return {
		workspacePath: ws?.workspacePath ?? null,
		recentWorkspaces: Array.isArray(ws?.recentWorkspaces)
			? ws.recentWorkspaces
			: [],
		sortMode: ws?.sortMode === "alpha" ? "alpha" : "recent",
		files: [],
		folders: [],
		pinnedNotes: [],
	};
}

export function getInitialState(): DesktopState {
	const p = readStorage<Persisted>(STORAGE_KEY);
	const workspace = hydrateWorkspace(p?.workspace);
	const tabSessions = readTabSessions(p?.tabSessions);
	return {
		workspace,
		tabSessions,
		document: emptyDoc(),
		tabs: tabsFromSession(tabSessions[workspace.workspacePath ?? ""]),
		ui: {
			sidebarOpen: p?.ui?.sidebarOpen ?? false,
			isSwitcherOpen: false,
			isTerminalOpen: p?.ui?.isTerminalOpen ?? false,
			terminalPosition:
				p?.ui?.terminalPosition === "right" ? "right" : "bottom",
			pendingTerminalCommand: null,
		},
		settings: {
			chatCommand:
				typeof p?.settings?.chatCommand === "string"
					? p.settings.chatCommand
					: DEFAULT_CHAT_COMMAND,
			codeFileOpenMode:
				p?.settings?.codeFileOpenMode === "default-app"
					? "default-app"
					: "hubble",
			// A missing field on an existing install means the user updated from
			// a release that predates version tracking: treat the running version
			// as news. Only a truly fresh install starts at null (no callout).
			lastSeenVersion:
				typeof p?.settings?.lastSeenVersion === "string"
					? p.settings.lastSeenVersion
					: p
						? ""
						: null,
			shortcutBindings: cleanCommandBindings(p?.settings?.shortcutBindings),
			theme:
				p?.settings?.theme === "light" || p?.settings?.theme === "dark"
					? p.settings.theme
					: "system",
		},
	};
}

export function serialize(state: DesktopState): Persisted {
	return {
		tabSessions: {
			...state.tabSessions,
			[state.workspace.workspacePath ?? ""]: tabSession(state.tabs),
		},
		workspace: {
			workspacePath: state.workspace.workspacePath,
			recentWorkspaces: state.workspace.recentWorkspaces,
			sortMode: state.workspace.sortMode,
		},
		ui: {
			sidebarOpen: state.ui.sidebarOpen,
			isTerminalOpen: state.ui.isTerminalOpen,
			terminalPosition: state.ui.terminalPosition,
		},
		settings: {
			chatCommand: state.settings.chatCommand,
			codeFileOpenMode: state.settings.codeFileOpenMode,
			lastSeenVersion: state.settings.lastSeenVersion,
			shortcutBindings: state.settings.shortcutBindings,
			theme: state.settings.theme,
		},
	};
}

const closedTabSchema = z.object({
	path: z.string().min(1),
	index: z.number().int().nonnegative(),
});

const tabSessionSchema = z
	.object({
		paths: z
			.array(z.string().min(1).catch(""))
			.transform((paths) => [...new Set(paths.filter(Boolean))]),
		activePath: z.string().nullable().catch(null),
		closed: z
			.array(closedTabSchema)
			.catch([])
			.transform((closed) => closed.slice(-MAX_CLOSED_TABS)),
	})
	.transform(
		({ paths, activePath, closed }): TabSession => ({
			closed,
			paths,
			activePath:
				activePath && paths.includes(activePath)
					? activePath
					: (paths[0] ?? null),
		}),
	);

const tabSessionsSchema = z
	.record(z.string(), tabSessionSchema.nullable().catch(null))
	.catch({});

function readTabSessions(value: unknown): Record<string, TabSession> {
	return Object.fromEntries(
		Object.entries(tabSessionsSchema.parse(value)).filter(
			(entry): entry is [string, TabSession] => entry[1] !== null,
		),
	);
}
