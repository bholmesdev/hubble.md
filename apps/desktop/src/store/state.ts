import { store } from "@simplestack/store";
import type { FileAction } from "../externalFileChange";
import { localStoragePersist } from "../lib/localStoragePersist";
import {
	type DesktopState,
	getInitialState,
	STORAGE_KEY,
	serialize,
} from "./persistence";

export type SortMode = "alpha" | "recent";

export type FileEntry = {
	path: string;
	modified_at: number;
};

export type FolderEntry = FileEntry;

type ViewerStatus = "idle" | "loading" | "ready" | "error";
export type ViewMode = "rich" | "source";
type ExternalChange =
	| { kind: "none" }
	| { kind: "conflict"; diskContent: string };

type DocumentState = {
	currentPath: string | null;
	lastOpenedPath: string | null;
	content: string;
	diskContent: string;
	externalChange: ExternalChange;
	status: ViewerStatus;
	error: string | null;
	viewMode: ViewMode;
};

const NO_CONFLICT: ExternalChange = { kind: "none" };

export const MAX_RECENT = 10;
export const LOADING_DELAY_MS = 150;
export const MAX_HISTORY = 50;

export type HistoryStack = {
	entries: string[];
	index: number;
};

export type HistoryState = {
	byWorkspace: Record<string, HistoryStack>;
	isNavigating: boolean;
};

export const emptyDoc = (
	lastOpenedPath: string | null = null,
): DocumentState => ({
	currentPath: null,
	lastOpenedPath,
	content: "",
	diskContent: "",
	externalChange: NO_CONFLICT,
	status: "idle",
	error: null,
	viewMode: "rich",
});

export function cleanFileState(content: string) {
	return {
		content,
		diskContent: content,
		externalChange: NO_CONFLICT,
		status: "ready" as const,
		error: null,
	};
}

export function getBaseline(state: DocumentState) {
	return state.externalChange.kind === "conflict"
		? state.externalChange.diskContent
		: state.diskContent;
}

export function applyFileAction(
	state: DocumentState,
	diskContent: string,
	action: FileAction,
): DocumentState {
	switch (action) {
		case "none":
			return state;
		case "match":
		case "reload":
			return {
				...state,
				...cleanFileState(diskContent),
			};
		case "conflict":
			return {
				...state,
				status: "ready",
				error: null,
				externalChange: {
					kind: "conflict",
					diskContent,
				},
			};
	}
}

export function isInWorkspace(
	path: string,
	workspacePath: string | null,
): boolean {
	if (!workspacePath) return false;
	if (path === workspacePath) return true;
	const normalizedWorkspace = workspacePath.endsWith("/")
		? workspacePath
		: `${workspacePath}/`;
	return path.startsWith(normalizedWorkspace);
}

export function withOpenedDoc(
	state: DesktopState,
	path: string,
	content: string,
): DesktopState {
	const workspacePath = state.workspace.workspacePath;
	const workspace =
		workspacePath && isInWorkspace(path, workspacePath)
			? {
					...state.workspace,
					lastOpenedPaths: {
						...state.workspace.lastOpenedPaths,
						[workspacePath]: path,
					},
				}
			: state.workspace;

	return {
		...state,
		workspace,
		document: {
			...state.document,
			currentPath: path,
			lastOpenedPath: path,
			...cleanFileState(content),
			viewMode: "rich",
		},
	};
}

// ── Stores ──────────────────────────────────────────────────────────

export const appStore = store<DesktopState>(getInitialState(), {
	middleware: [localStoragePersist(STORAGE_KEY, serialize)],
});

export const historyStore = store<HistoryState>({
	byWorkspace: {},
	isNavigating: false,
});

export const workspaceStore = appStore.select("workspace");
export const viewerStore = appStore.select("document");
export const uiStore = appStore.select("ui");

export const workspacePathStore = workspaceStore.select("workspacePath");
export const recentWorkspacesStore = workspaceStore.select("recentWorkspaces");
export const currentPathStore = viewerStore.select("currentPath");
export const sidebarOpenStore = uiStore.select("sidebarOpen");
export const switcherOpenStore = uiStore.select("isSwitcherOpen");
export const terminalOpenStore = uiStore.select("isTerminalOpen");
export const terminalPositionStore = uiStore.select("terminalPosition");
export const pendingTerminalCommandStore = uiStore.select(
	"pendingTerminalCommand",
);
export const chatCommandStore = appStore
	.select("settings")
	.select("chatCommand");
export const lastSeenVersionStore = appStore
	.select("settings")
	.select("lastSeenVersion");
