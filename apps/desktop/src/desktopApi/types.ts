export type FileEntry = {
	path: string;
	modified_at: number;
};

export type FolderEntry = FileEntry;

export type DirectoryListing = {
	files: FileEntry[];
	folders: FolderEntry[];
};

export type HtmlAppFileEntry = {
	name: string;
	path: string;
	modified_at: number;
	size: number;
};

export type SearchContentMatch = {
	/** 1-indexed line number within the file. */
	line: number;
	/** Trimmed line, windowed around the match, with ellipses when clipped. */
	excerpt: string;
	matchStart: number;
	matchEnd: number;
};

export type SearchFileResult = {
	path: string;
	matches: SearchContentMatch[];
};

export type SearchFileContentsInput = {
	/** Monotonic per-renderer id. Main abandons a search once it is superseded. */
	requestId: number;
	/** Candidate paths, taken from the sidebar snapshot. Main never re-walks. */
	paths: string[];
	query: string;
};

export type SearchFileContentsOutput = {
	requestId: number;
	results: SearchFileResult[];
	/** True when the file cap was hit before every candidate was scanned. */
	truncated: boolean;
};

export type PersistPastedImageInput = {
	filePath: string;
	bytes: number[];
	mimeType: string | null;
};

export type PersistPastedImageOutput = {
	relativeMarkdownPath: string;
	deduped: boolean;
};

export type OpenPathFromLinkResult =
	| { kind: "markdown"; path: string }
	| { kind: "opened" };

export type WatchOptions = {
	recursive: boolean;
};

export type Unsubscribe = () => void;

export type MenuState = {
	hasWorkspace: boolean;
	hasMarkdownNoteOpen: boolean;
	isSourceMode: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
};

export type DesktopUpdateStatus =
	| "idle"
	| "checking"
	| "up-to-date"
	| "downloading"
	| "ready"
	| "error";

export type DesktopUpdateState = {
	isSupported: boolean;
	status: DesktopUpdateStatus;
	currentVersion: string;
	availableVersion: string | null;
	progressPercent: number | null;
	message: string | null;
	lastCheckedAt: number | null;
};

export type DesktopPlatform = NodeJS.Platform;

export type TerminalStartOptions = {
	notePath?: string;
	initialCommand?: string;
};

export type WorkspaceConfig = {
	version: 1;
	pinnedNotes: string[];
};

export type DesktopApi = {
	platform: DesktopPlatform;
	homeDir: string;
	listDirectory(path: string): Promise<DirectoryListing>;
	listHtmlAppFiles(
		workspacePath: string,
		glob: string,
	): Promise<HtmlAppFileEntry[]>;
	readWorkspaceConfig(workspacePath: string): Promise<WorkspaceConfig>;
	writeWorkspaceConfig(
		workspacePath: string,
		config: WorkspaceConfig,
	): Promise<void>;
	readFileText(path: string): Promise<string>;
	searchFileContents(
		input: SearchFileContentsInput,
	): Promise<SearchFileContentsOutput>;
	detectHubbleSkills(workspacePath: string): Promise<boolean>;
	writeFileText(path: string, content: string): Promise<void>;
	createFolder(path: string): Promise<void>;
	renameFile(fromPath: string, toPath: string): Promise<void>;
	pathExists(path: string): Promise<boolean>;
	persistPastedImage(
		input: PersistPastedImageInput,
	): Promise<PersistPastedImageOutput>;
	deleteFile(path: string, options?: { recursive?: boolean }): Promise<void>;
	readBinaryFile(path: string): Promise<number[]>;
	writeBinaryFile(path: string, bytes: number[]): Promise<void>;
	openFilePicker(options: { defaultPath?: string }): Promise<string | null>;
	openFolderPicker(): Promise<string | null>;
	createFolderPicker(): Promise<string | null>;
	saveMarkdownFilePicker(options: {
		defaultPath?: string;
	}): Promise<string | null>;
	watchPath(
		path: string,
		options: WatchOptions,
		callback: (paths: string[]) => void,
	): Promise<Unsubscribe>;
	openExternalUrl(url: string): Promise<void>;
	openPathFromLink(path: string): Promise<OpenPathFromLinkResult>;
	revealFile(path: string): Promise<void>;
	resolvePath(path: string): Promise<string>;
	realPath(path: string): Promise<string>;
	toAssetUrl(path: string): string;
	getLaunchFilePath(): Promise<string | null>;
	getLaunchWorkspacePath(): Promise<string | null>;
	setMenuState(state: MenuState): Promise<void>;
	getUpdateState(): Promise<DesktopUpdateState>;
	getFullScreen(): Promise<boolean>;
	checkForUpdates(): Promise<void>;
	installUpdate(): Promise<void>;
	onOpenFile(callback: (path: string) => void): Unsubscribe;
	onUpdateStateChange(
		callback: (state: DesktopUpdateState) => void,
	): Unsubscribe;
	onMenuCreateMarkdownFile(callback: () => void): Unsubscribe;
	onMenuCreateHtmlFile(callback: () => void): Unsubscribe;
	onMenuOpenFile(callback: () => void): Unsubscribe;
	onMenuOpenFolder(callback: () => void): Unsubscribe;
	onMenuOpenSettings(callback: () => void): Unsubscribe;
	onMenuOpenChangelog(callback: () => void): Unsubscribe;
	onMenuCopyAsMarkdown(callback: () => void): Unsubscribe;
	onMenuShowWorkspaceSwitcher(callback: () => void): Unsubscribe;
	onMenuGoToFile(callback: () => void): Unsubscribe;
	onMenuSyncWorkspace(callback: () => void): Unsubscribe;
	onMenuToggleTerminal(callback: () => void): Unsubscribe;
	onMenuGoBack(callback: () => void): Unsubscribe;
	onMenuGoForward(callback: () => void): Unsubscribe;
	onMenuToggleSourceMode(callback: () => void): Unsubscribe;
	onWindowFocus(callback: () => void): Unsubscribe;
	onFullScreenChange(callback: (isFullScreen: boolean) => void): Unsubscribe;

	// Terminal
	terminalStart(cwd: string, options?: TerminalStartOptions): Promise<string>;
	terminalWrite(sessionId: string, data: string): Promise<void>;
	terminalResize(sessionId: string, cols: number, rows: number): Promise<void>;
	terminalStop(sessionId: string): Promise<void>;
	onTerminalData(
		sessionId: string,
		callback: (data: string) => void,
	): Unsubscribe;
	onTerminalExit(sessionId: string, callback: () => void): Unsubscribe;
};
