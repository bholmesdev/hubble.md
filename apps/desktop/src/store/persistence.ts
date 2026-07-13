import { DEFAULT_CHAT_COMMAND } from "./settings";
import { emptyDoc, type SortMode } from "./state";

type WorkspaceState = {
	workspacePath: string | null;
	recentWorkspaces: string[];
	lastOpenedPaths: Record<string, string>;
	sortMode: SortMode;
	files: { path: string; modified_at: number }[];
	folders: { path: string; modified_at: number }[];
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
	lastSeenVersion: string | null;
};

export type DesktopState = {
	workspace: WorkspaceState;
	document: DocumentState;
	ui: UiState;
	settings: SettingsState;
};

type Persisted = {
	workspace?: {
		workspacePath?: string | null;
		recentWorkspaces?: string[];
		lastOpenedPaths?: Record<string, string>;
		sortMode?: SortMode;
	};
	document?: { lastOpenedPath?: string | null };
	ui?: {
		sidebarOpen?: boolean;
		isTerminalOpen?: boolean;
		terminalPosition?: TerminalPosition;
	};
	settings?: { chatCommand?: string; lastSeenVersion?: string | null };
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
		lastOpenedPaths:
			ws?.lastOpenedPaths &&
			typeof ws.lastOpenedPaths === "object" &&
			!Array.isArray(ws.lastOpenedPaths)
				? ws.lastOpenedPaths
				: {},
		sortMode: ws?.sortMode === "alpha" ? "alpha" : "recent",
		files: [],
		folders: [],
		pinnedNotes: [],
	};
}

export function getInitialState(): DesktopState {
	const p = readStorage<Persisted>(STORAGE_KEY);
	return {
		workspace: hydrateWorkspace(p?.workspace),
		document: emptyDoc(p?.document?.lastOpenedPath ?? null),
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
			// A missing field on an existing install means the user updated from
			// a release that predates version tracking: treat the running version
			// as news. Only a truly fresh install starts at null (no callout).
			lastSeenVersion:
				typeof p?.settings?.lastSeenVersion === "string"
					? p.settings.lastSeenVersion
					: p
						? ""
						: null,
		},
	};
}

export function serialize(state: DesktopState): Persisted {
	return {
		workspace: {
			workspacePath: state.workspace.workspacePath,
			recentWorkspaces: state.workspace.recentWorkspaces,
			lastOpenedPaths: state.workspace.lastOpenedPaths,
			sortMode: state.workspace.sortMode,
		},
		document: {
			lastOpenedPath: state.document.lastOpenedPath,
		},
		ui: {
			sidebarOpen: state.ui.sidebarOpen,
			isTerminalOpen: state.ui.isTerminalOpen,
			terminalPosition: state.ui.terminalPosition,
		},
		settings: {
			chatCommand: state.settings.chatCommand,
			lastSeenVersion: state.settings.lastSeenVersion,
		},
	};
}
