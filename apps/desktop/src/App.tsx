import {
	type AppCommandId,
	commandRegistry,
	getCommand,
	getCommandBinding,
	getCommandBindings,
	resolveCommandBinding,
	wikiDisplayNameForTarget,
} from "@hubble.md/editor";
import {
	Button,
	classifyHref,
	EditorView,
	formatShortcut,
	GlobalSearchPalette,
	getActiveEditor,
	MarkdownSourceEditor,
	OPEN_COMMAND_PALETTE_EVENT,
	type PaletteFile,
	PlainTextEditor,
	type SpellcheckStatus,
	setAllSidebarFoldersExpanded,
	type WikiTarget,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { keymatch } from "keymatch";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
	recentCommandIdsStore,
	recordRecentCommand,
} from "./commands/recentCommands";
import { buildAppCommands } from "./commands/useAppCommands";
import { FileInfoBar } from "./components/FileInfoBar";
import { HtmlAppEmptyState } from "./components/HtmlAppEmptyState";
import { NewTabPage } from "./components/NewTabPage";
import { Settings, type SettingsTarget } from "./components/Settings";
import { type DesktopSidebarFocus, Sidebar } from "./components/Sidebar";
import { SkippedSkillsDialog } from "./components/SkippedSkillsDialog";
import { TelemetryConsentCallout } from "./components/TelemetrySection";
import { TerminalPanel } from "./components/TerminalPanel";
import { SidebarCallout } from "./components/UpdatesSection";
import { WelcomeScreen } from "./components/WelcomeScreen";
import {
	SidebarOverlayTitleRow,
	WindowTitleBar,
} from "./components/WindowTitleBar";
import { desktopApi } from "./desktopApi";
import type { DesktopUpdateState } from "./desktopApi/types";
import { runEditCommand, runZoomCommand } from "./editor/diagramCommands";
import { createEmbedExtension } from "./editor/EmbedExtension";
import { handleImageDrop, handleImagePaste } from "./editor/handleImagePaste";
import { IframeView, toAssetUrl } from "./editor/IframeView";
import { createImageExtension } from "./editor/ImageExtension";
import { DiagramView } from "./editor/lazyDiagram";
import {
	createDiagramFile,
	createHtmlFile,
	createMarkdownFile,
} from "./fileActions";
import { isChangelogPath } from "./lib/changelogNote";
import { copyText } from "./lib/clipboard";
import {
	dirname,
	fileKindForPath,
	hasHtmlExtension,
	hasImageExtension,
	hasPdfExtension,
	hasTextExtension,
	isCodeFile,
	isDiagramFile,
	isEditableFile,
	pathEquals,
	relativeWorkspacePath,
	sourceLanguageForPath,
	supportsSourceToggle,
} from "./lib/filePath";
import { installHubbleSkills } from "./lib/hubbleSkills";
import { isCompactWindow, useCompactWindow } from "./lib/layout";
import { isNewTabPath, isVirtualPath } from "./lib/newTabPage";
import { resolveRelativeLinkPath } from "./lib/relativeLinkPath";
import { isDefaultLanguage, languageName } from "./lib/spellcheckLanguages";
import { useScrollMemory } from "./lib/useScrollMemory";
import { resolveWikiPath } from "./lib/wikiPath";
import { SIDEBAR_NAV_SELECTOR } from "./selectors";
import {
	activateAdjacentTab,
	closeActiveTab,
	createWorkspaceWithSidebar,
	editorDocumentId,
	forceKeepLocalEdits,
	getPendingRenameTarget,
	goBack,
	goForward,
	handleExternalFileChange,
	loadPath,
	loadSettingsState,
	openChangelog,
	openNewTabPage,
	openWorkspace,
	openWorkspaceWithSidebar,
	reconcileWorkspacePath,
	refreshFileList,
	refreshFiles,
	refreshFilesDebounced,
	reloadFromDiskConflict,
	reopenClosedTab,
	requestChatAboutNote,
	restoreTabs,
	savePathContent,
	setLastSeenVersion,
	setReviewThreads,
	setSidebarOpen,
	setTelemetryConsent,
	setViewerMode,
	setWorkspaceSwitcherOpen,
	toggleSidebarView,
	toggleTerminal,
	undoDelete,
	updateEditorContent,
} from "./store/actions";
import { canGoBack, canGoForward } from "./store/history";
import { useHistoryNav } from "./store/hooks";
import type { SidebarView } from "./store/persistence";
import {
	lastSeenVersionStore,
	launchFileSettledStore,
	shortcutBindingsStore,
	sidebarOpenStore,
	sidebarViewStore,
	spellcheckStore,
	telemetryConsentStore,
	terminalPositionStore,
	uiStore,
	type ViewMode,
	viewerStore,
	workspacePathStore,
	workspaceStore,
} from "./store/state";
import { tabsStore } from "./store/tabStore";
import { isDarkTheme, subscribeTheme } from "./theme";

// Forces editor refresh when underlying TipTap extensions change
const HMR_REV = (() => {
	if (!import.meta.hot) return 0;
	const hotData = import.meta.hot.data as { __editorRev?: number };
	hotData.__editorRev = (hotData.__editorRev ?? 0) + 1;
	return hotData.__editorRev;
})();

function sameSidebarFocus(
	current: DesktopSidebarFocus,
	next: DesktopSidebarFocus,
) {
	if (!current || !next) return current === next;
	return current.kind === next.kind && current.path === next.path;
}

function folderForSidebarFocus(
	item: DesktopSidebarFocus,
	workspacePath: string | null | undefined,
) {
	if (!item) return workspacePath ?? null;
	if (item.kind === "folder") return item.path;
	return dirname(item.path) ?? workspacePath ?? null;
}

function focusSidebarNav() {
	document.querySelector<HTMLElement>(SIDEBAR_NAV_SELECTOR)?.focus();
}

function showSidebarView(view: SidebarView) {
	if (toggleSidebarView(view)) requestAnimationFrame(() => focusSidebarNav());
}

async function copyFilePath(path: string | null) {
	if (!path) return;
	await copyText(path, "File path");
}

async function revealPath(path: string | null) {
	if (!path) return;

	try {
		await desktopApi.revealFile(path);
	} catch {
		toast.error("Failed to reveal file");
	}
}

async function openFilePicker() {
	const currentPath = viewerStore.get().currentPath;
	const defaultPath =
		(isVirtualPath(currentPath) ? null : currentPath) ??
		workspaceStore.get().workspacePath ??
		undefined;
	const selected = await desktopApi.openFilePicker({ defaultPath });
	if (typeof selected === "string") {
		await loadPath(selected);
	}
}

// Covers the title bar too, so the view toggle sits where the docked sidebar puts it.
const SIDEBAR_OVERLAY =
	"max-sm:absolute max-sm:inset-y-0 max-sm:start-0 max-sm:z-30 max-sm:flex max-sm:flex-col max-sm:bg-sidebar max-sm:shadow-overlay max-sm:transition-transform max-sm:motion-reduce:transition-none";
const SIDEBAR_OVERLAY_SHOWN =
	"contents max-sm:translate-x-0 max-sm:duration-[180ms] max-sm:ease-[cubic-bezier(0.25,1,0.5,1)]";
const SIDEBAR_OVERLAY_HIDDEN =
	"hidden max-sm:-translate-x-full max-sm:pointer-events-none max-sm:duration-[140ms] max-sm:ease-[cubic-bezier(0.25,1,0.5,1)]";

let nextSearchRequestId = 0;

/**
 * Content search reads the sidebar snapshot's paths rather than asking main to
 * re-crawl, so search and the sidebar always agree on what exists (ADR-0008).
 */
async function searchFileContents(query: string) {
	nextSearchRequestId += 1;
	const { files } = workspaceStore.get();
	const { results, truncated } = await desktopApi.searchFileContents({
		requestId: nextSearchRequestId,
		paths: files
			.filter(
				(file) => (file.kind ?? fileKindForPath(file.path)) === "document",
			)
			.map((file) => file.path),
		query,
	});
	return { results, truncated };
}

function App() {
	const state = useStoreValue(viewerStore);
	const compact = useCompactWindow();
	const workspacePath = useStoreValue(workspacePathStore);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const sidebarView = useStoreValue(sidebarViewStore);
	const terminalPosition = useStoreValue(terminalPositionStore);
	const shortcutBindings = useStoreValue(shortcutBindingsStore);
	const tabs = useStoreValue(tabsStore);
	const hasWorkspace = workspacePath !== null;
	const { canGoBack: menuCanGoBack, canGoForward: menuCanGoForward } =
		useHistoryNav();
	const [scrollContainerEl, setScrollContainerEl] =
		useState<HTMLDivElement | null>(null);
	useScrollMemory(state.currentPath, scrollContainerEl);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsTarget, setSettingsTarget] = useState<SettingsTarget>();
	const settingsRequestId = useRef(0);
	const changeSettingsOpen = (open: boolean) => {
		setSettingsOpen(open);
		if (!open) setSettingsTarget(undefined);
	};
	const [allTabsOpen, setAllTabsOpen] = useState(false);
	const [copyAsMarkdownRequest, setCopyAsMarkdownRequest] = useState(0);
	const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(
		null,
	);
	const telemetryConsent = useStoreValue(telemetryConsentStore);
	const spellcheck = useStoreValue(spellcheckStore);
	const [focusedSidebarItem, setFocusedSidebarItem] =
		useState<DesktopSidebarFocus>(null);
	const updateFocusedSidebarItem = (next: DesktopSidebarFocus) => {
		setFocusedSidebarItem((current) =>
			sameSidebarFocus(current, next) ? current : next,
		);
	};
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchFolderParent, setSearchFolderParent] = useState<string | null>(
		null,
	);
	const recentCommandIds = useStoreValue(recentCommandIdsStore);
	const workspaceFiles = useStoreValue(workspaceStore).files;
	const paletteFiles: PaletteFile[] = workspaceFiles
		.filter((file) => (file.kind ?? fileKindForPath(file.path)) === "document")
		.map((file) => ({
			path: file.path,
			relativePath: relativeWorkspacePath(file.path, workspacePath ?? null),
			modifiedAt: file.modified_at,
		}));
	const lastSeenVersion = useStoreValue(lastSeenVersionStore);
	const pinnedNotes = useStoreValue(workspaceStore).pinnedNotes;
	const isDark = useSyncExternalStore(subscribeTheme, isDarkTheme, () => false);
	const focusedSidebarPath = focusedSidebarItem
		? focusedSidebarItem.path
		: null;
	const focusedFolderParent = folderForSidebarFocus(
		focusedSidebarItem,
		workspacePath,
	);
	const focusedCreationFolder =
		focusedSidebarItem?.kind === "folder" ? focusedSidebarItem.path : null;
	const closeSidebarOverlay = () => {
		if (sidebarOpen && compact) {
			setSidebarOpen(false);
		}
	};

	useEffect(() => {
		if (compact) setSidebarOpen(false);
	}, [compact]);

	// An open folder always keeps at least one tab, so closing the last one
	// (or deleting its file) lands on a blank new tab page.
	const needsBlankTab =
		hasWorkspace && tabs.order.length === 0 && state.status !== "loading";
	useEffect(() => {
		if (needsBlankTab) void openNewTabPage();
	}, [needsBlankTab]);
	const changeSearchOpen = (open: boolean) => {
		if (open) setSearchFolderParent(focusedFolderParent ?? null);
		setSearchOpen(open);
	};
	const openSearch = () => changeSearchOpen(true);
	const newTab = hasWorkspace ? () => openNewTabPage() : undefined;
	const isFileOpen =
		Boolean(state.currentPath) && !isNewTabPath(state.currentPath);
	// A lone tab folds the strip away to save a row: a note moves its file info
	// into the title bar, and a blank new tab leaves just the empty state.
	const wantsTabStrip = tabs.order.length > 1 || !hasWorkspace;
	// Trails wantsTabStrip by one view transition, so the strip slides.
	const [showTabStrip, setShowTabStrip] = useState(wantsTabStrip);
	const tabStripTransitionRef = useRef<ViewTransition | null>(null);
	const activeTabPath = tabs.activeTabId
		? tabs.byId[tabs.activeTabId]?.path
		: undefined;
	// Closing a tab loads its neighbor; switch once it shows, so the file info
	// row is there to slide.
	const activeTabShown =
		!activeTabPath ||
		(pathEquals(state.currentPath ?? "", activeTabPath) &&
			state.status !== "loading");
	useLayoutEffect(() => {
		if (wantsTabStrip === showTabStrip) return;
		function switchTabStrip() {
			if (
				!document.startViewTransition ||
				window.matchMedia("(prefers-reduced-motion: reduce)").matches
			) {
				setShowTabStrip(wantsTabStrip);
				return;
			}
			// Names only apply mid-transition; they'd otherwise isolate the strip
			// and keep the active tab from covering the divider below it.
			const root = document.documentElement;
			root.dataset.tabStripTransition = "";
			const transition = document.startViewTransition(() =>
				flushSync(() => setShowTabStrip(wantsTabStrip)),
			);
			tabStripTransitionRef.current = transition;
			void transition.finished.finally(() => {
				if (tabStripTransitionRef.current === transition)
					delete root.dataset.tabStripTransition;
			});
		}
		if (activeTabShown) {
			switchTabStrip();
			return;
		}
		// Don't wait on a load that stalls or fails.
		const timeout = setTimeout(switchTabStrip, 300);
		return () => clearTimeout(timeout);
	}, [wantsTabStrip, showTabStrip, activeTabShown]);
	const createNewFile = () => {
		const created = createMarkdownFile(focusedCreationFolder);
		if (searchOpen) changeSearchOpen(false);
		return created;
	};
	const paletteCommands = buildAppCommands(
		{
			createNewFile,
			openSettings: () => setSettingsOpen(true),
			requestCopyAsMarkdown: () =>
				setCopyAsMarkdownRequest((request) => request + 1),
			focusSidebar: focusSidebarNav,
			openNewTab: () => openNewTabPage(),
			toggleAllTabs: () => setAllTabsOpen((open) => !open),
		},
		{
			currentPath: state.currentPath ?? null,
			newFolderParent: searchOpen
				? searchFolderParent
				: (focusedFolderParent ?? null),
			workspacePath: workspacePath ?? null,
			isSourceMode: state.viewMode === "source",
			sidebarOpen,
			isDark,
			isPinned: state.currentPath
				? pinnedNotes.includes(state.currentPath)
				: false,
		},
	);

	const readyVersion =
		updateState?.status === "ready"
			? (updateState.availableVersion ?? "__unknown__")
			: null;
	const showReadyCallout =
		readyVersion !== null && readyVersion !== dismissedVersion;

	const currentVersion = updateState?.currentVersion ?? null;
	// First launch after an update: the persisted version lags behind the
	// running one until the callout is opened or dismissed.
	const whatsNewVersion =
		currentVersion !== null &&
		lastSeenVersion !== null &&
		lastSeenVersion !== currentVersion
			? currentVersion
			: null;
	const markWhatsNewSeen = () => {
		if (currentVersion) setLastSeenVersion(currentVersion);
	};

	useEffect(loadSettingsState, []);

	const spellcheckStatus: SpellcheckStatus | null =
		spellcheck?.enabled &&
		spellcheck.languages.length > 0 &&
		desktopApi.platform !== "darwin" &&
		!isDefaultLanguage(spellcheck.languages, spellcheck.systemLanguage)
			? {
					languages: spellcheck.languages.map(languageName),
					openSettings: () => setSettingsOpen(true),
				}
			: null;

	useEffect(() => {
		// First install has no update to announce; just record the version.
		if (currentVersion && lastSeenVersion === null) {
			setLastSeenVersion(currentVersion);
		}
	}, [currentVersion, lastSeenVersion]);

	const openWhatsNew = () => {
		changeSettingsOpen(false);
		void openChangelog();
	};

	const installUpdate = async () => {
		try {
			await desktopApi.installUpdate();
		} catch (error) {
			toast.error("Failed to install update", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const triggerPrimaryUpdateAction = async () => {
		if (!updateState?.isSupported) return;
		if (updateState.status === "ready") {
			await installUpdate();
			return;
		}
		await desktopApi.checkForUpdates();
	};

	useEffect(() => {
		const currentPath = state.currentPath;
		// Only editable text files participate in external-change conflict handling.
		if (
			!currentPath ||
			isVirtualPath(currentPath) ||
			!isEditableFile(currentPath)
		)
			return;

		let disposed = false;
		let unwatch: null | (() => void) = null;

		const handleChange = async (paths: string[]) => {
			if (!paths.includes(currentPath)) return;
			if (getPendingRenameTarget(currentPath)) return;
			try {
				const nextContent = await desktopApi.readFileText(currentPath);
				if (viewerStore.get().currentPath !== currentPath) return;
				handleExternalFileChange(currentPath, nextContent);
			} catch {
				if (viewerStore.get().currentPath !== currentPath) return;
				await loadPath(currentPath, { launchExternal: false });
			}
		};

		const setup = async () => {
			unwatch = await desktopApi.watchPath(
				currentPath,
				{ recursive: false },
				(paths) => void handleChange(paths),
			);
			if (disposed && unwatch) {
				unwatch();
			}
		};

		void setup();
		return () => {
			disposed = true;
			if (unwatch) {
				unwatch();
			}
		};
	}, [state.currentPath]);

	useEffect(() => {
		const currentPath = state.currentPath;
		void desktopApi.setMenuState({
			hasWorkspace,
			isFolderViewOpen:
				hasWorkspace && sidebarOpen && sidebarView === "folders",
			hasSourceViewOpen:
				typeof currentPath === "string" && supportsSourceToggle(currentPath),
			isSourceMode: state.viewMode === "source",
			canGoBack: menuCanGoBack,
			canGoForward: menuCanGoForward,
			tabCount: tabs.order.length,
			hasClosedTabs: tabs.closed.length > 0,
			hasDiagramOpen:
				typeof currentPath === "string" && isDiagramFile(currentPath),
		});
	}, [
		hasWorkspace,
		sidebarOpen,
		sidebarView,
		menuCanGoBack,
		menuCanGoForward,
		state.currentPath,
		state.viewMode,
		tabs.order.length,
		tabs.closed.length,
	]);

	useEffect(() => {
		void desktopApi.setShortcutBindings(shortcutBindings);
	}, [shortcutBindings]);

	useEffect(() => {
		if (!sidebarOpen) setFocusedSidebarItem(null);
	}, [sidebarOpen]);

	useEffect(() => {
		const onKeyDown = async (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const formatBinding = getCommandBinding("app.format-menu");
			if (formatBinding && keymatch(event, formatBinding)) {
				const editor = getActiveEditor();
				if (editor?.isFocused && !editor.state.selection.empty) return;
				event.preventDefault();
				window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
				return;
			}
			const currentPath = focusedSidebarPath ?? viewerStore.get().currentPath;
			// Chat targets the note open in the viewer, not the sidebar focus.
			const viewerPath = viewerStore.get().currentPath;
			const context = {
				hasCurrentFile: Boolean(currentPath && !isVirtualPath(currentPath)),
				hasEditableFile: Boolean(
					viewerPath &&
						!isVirtualPath(viewerPath) &&
						isEditableFile(viewerPath),
				),
				hasWorkspace: Boolean(workspaceStore.get().workspacePath),
				canGoBack: canGoBack(),
				canGoForward: canGoForward(),
			};
			const handlers: Partial<
				Record<AppCommandId, () => void | Promise<void>>
			> = {
				"app.go-back": goBack,
				"app.go-forward": goForward,
				"app.new-file": createNewFile,
				"app.settings": () => setSettingsOpen(true),
				"app.open-recent": () => setWorkspaceSwitcherOpen(true),
				"app.go-to-file": () => openSearch(),
				"app.new-tab": () => openNewTabPage(),
				"app.all-tabs": () => setAllTabsOpen((open) => !open),
				"app.open-folder": openWorkspaceWithSidebar,
				"app.open-file": openFilePicker,
				"app.copy-path": () => copyFilePath(currentPath),
				"app.reveal": () => revealPath(currentPath),
				"app.chat-about-note": requestChatAboutNote,
				"app.toggle-sidebar": () => {
					const opening = !uiStore.get().sidebarOpen;
					setSidebarOpen(opening);
					if (opening) requestAnimationFrame(() => focusSidebarNav());
				},
				"app.show-folders": () => showSidebarView("folders"),
				"app.show-inbox": () => showSidebarView("inbox"),
			};
			for (const [id, handler] of Object.entries(handlers) as [
				AppCommandId,
				() => void | Promise<void>,
			][]) {
				const command = getCommand(id);
				const binding = getCommandBinding(id);
				if (binding && keymatch(event, binding) && command.isEnabled(context)) {
					event.preventDefault();
					await handler();
					return;
				}
			}
			// The palette's binding can claim Cmd-P even when unavailable here; editor commands can too.
			if (
				!event.repeat &&
				keymatch(event, "CmdOrCtrl+P") &&
				!Object.keys(commandRegistry).some((id) => {
					const binding = resolveCommandBinding(
						id as keyof typeof commandRegistry,
						getCommandBindings(),
					);
					return binding && keymatch(event, binding);
				})
			) {
				event.preventDefault();
				const binding = getCommandBinding("app.go-to-file");
				toast(
					binding
						? `Command palette can now be opened with ${formatShortcut(binding)}`
						: "Command palette has no shortcut",
					{
						id: "command-p-shortcut-hint",
						action: {
							label: "Modify in settings",
							onClick: () => {
								settingsRequestId.current += 1;
								setSettingsTarget({
									page: "shortcuts",
									shortcutId: "app.go-to-file",
									requestId: settingsRequestId.current,
								});
								setSettingsOpen(true);
							},
						},
					},
				);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	}, [openSearch, createNewFile, focusedSidebarPath]);

	useEffect(() => {
		let active = true;
		void desktopApi.getUpdateState().then((nextState) => {
			if (active) setUpdateState(nextState);
		});
		const unsubscribe = desktopApi.onUpdateStateChange((nextState) => {
			setUpdateState(nextState);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		const unlisten = desktopApi.onOpenFile((path) => {
			void loadPath(path);
		});
		return () => {
			unlisten();
		};
	}, []);

	useEffect(() => {
		const disposers = [
			desktopApi.onUndoDelete(() => {
				void undoDelete().then((undone) => {
					if (!undone) runEditCommand("undo");
				});
			}),
			desktopApi.onMenuEdit(runEditCommand),
			desktopApi.onMenuZoom(runZoomCommand),
			desktopApi.onMenuCreateMarkdownFile(() => void createNewFile()),
			desktopApi.onMenuCreateHtmlFile(
				() => void createHtmlFile(focusedCreationFolder),
			),
			desktopApi.onMenuCreateDiagramFile(
				() => void createDiagramFile(focusedCreationFolder),
			),
			desktopApi.onMenuOpenFile(() => void openFilePicker()),
			desktopApi.onMenuOpenFolder(() => void openWorkspaceWithSidebar()),
			desktopApi.onMenuOpenSettings(() => setSettingsOpen(true)),
			desktopApi.onMenuOpenChangelog(() => {
				changeSettingsOpen(false);
				void openChangelog();
			}),
			desktopApi.onMenuInstallHubbleSkills(() => void installHubbleSkills()),
			desktopApi.onMenuCopyAsMarkdown(() =>
				setCopyAsMarkdownRequest((request) => request + 1),
			),
			desktopApi.onMenuShowWorkspaceSwitcher(() =>
				setWorkspaceSwitcherOpen(true),
			),
			desktopApi.onMenuGoToFile(() => openSearch()),
			desktopApi.onMenuNewTab(() => openNewTabPage()),
			desktopApi.onMenuSyncWorkspace(() => void refreshFiles()),
			desktopApi.onMenuToggleTerminal(() => toggleTerminal()),
			desktopApi.onMenuGoBack(() => void goBack()),
			desktopApi.onMenuGoForward(() => void goForward()),
			desktopApi.onMenuCloseTab(() => void closeActiveTab()),
			desktopApi.onMenuReopenClosedTab(() => void reopenClosedTab()),
			desktopApi.onMenuNextTab(() => void activateAdjacentTab(1)),
			desktopApi.onMenuPreviousTab(() => void activateAdjacentTab(-1)),
			desktopApi.onMenuExpandAllFolders(() =>
				setAllSidebarFoldersExpanded(true),
			),
			desktopApi.onMenuCollapseAllFolders(() =>
				setAllSidebarFoldersExpanded(false),
			),
			desktopApi.onMenuToggleSourceMode(() => {
				const current = viewerStore.get();
				if (
					!current.currentPath ||
					!supportsSourceToggle(current.currentPath)
				) {
					return;
				}
				setViewerMode(current.viewMode === "source" ? "rich" : "source");
			}),
		];
		return () => {
			for (const dispose of disposers) dispose();
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes render-local callbacks.
	}, [openSearch, createNewFile, focusedCreationFolder, changeSettingsOpen]);

	useEffect(() => {
		// Window focus can fire in bursts when switching apps, so debounce the
		// sidebar refresh and keep the editor interactive while it runs.
		const dispose = desktopApi.onWindowFocus(() => refreshFilesDebounced());
		return () => {
			dispose();
		};
	}, []);

	useEffect(() => {
		if (!workspacePath) return;
		let active = true;
		let generation: number | null = null;
		let workspaceChangeQueue = Promise.resolve();
		const dispose = desktopApi.onWorkspaceChanged((change) => {
			workspaceChangeQueue = workspaceChangeQueue
				.then(async () => {
					if (!active || workspaceStore.get().workspacePath !== workspacePath) {
						return;
					}
					if (change.kind === "refresh") {
						await refreshFileList(workspacePath);
						return;
					}
					for (const changedPath of change.paths) {
						if (!active) return;
						await reconcileWorkspacePath(workspacePath, changedPath);
					}
				})
				.catch((error) => {
					console.error("Workspace change reconciliation failed:", error);
				});
		});
		void desktopApi
			.startWorkspaceWatcher(workspacePath)
			.then((nextGeneration) => {
				if (!active) {
					if (nextGeneration !== null) {
						void desktopApi.stopWorkspaceWatcher(nextGeneration);
					}
					return;
				}
				generation = nextGeneration;
			})
			.catch((error) => {
				if (active) {
					console.error("Failed to start workspace watcher:", error);
				}
			});
		return () => {
			active = false;
			dispose();
			if (generation !== null) {
				void desktopApi.stopWorkspaceWatcher(generation);
			}
		};
	}, [workspacePath]);

	useEffect(() => {
		let active = true;
		const init = async () => {
			const launchPath = await desktopApi.getLaunchFilePath();
			if (!active) return;

			if (typeof launchPath === "string" && launchPath.length > 0) {
				// A failed load must not leave the terminal unable to start.
				await loadPath(launchPath).finally(() =>
					launchFileSettledStore.set(true),
				);
				return;
			}
			launchFileSettledStore.set(true);
			const launchWorkspacePath = await desktopApi.getLaunchWorkspacePath();
			if (!active) return;

			if (
				typeof launchWorkspacePath === "string" &&
				launchWorkspacePath.length > 0
			) {
				await openWorkspace(launchWorkspacePath);
				if (!isCompactWindow()) {
					setSidebarOpen(true);
				}
				return;
			}
			await restoreTabs();
		};
		void init();
		return () => {
			active = false;
		};
	}, []);

	return (
		<main
			className="relative flex h-dvh flex-col bg-background text-foreground"
			onPointerDownCapture={(event) => {
				if (
					event.target instanceof Element &&
					!event.target.closest(
						"[data-sidebar-overlay], [data-sidebar-portal], [data-sidebar-toggle]",
					)
				) {
					closeSidebarOverlay();
				}
			}}
			onKeyDown={(event) => {
				if (
					!event.defaultPrevented &&
					event.key === "Escape" &&
					sidebarOpen &&
					isCompactWindow()
				) {
					event.preventDefault();
					setSidebarOpen(false);
				}
			}}
		>
			<WindowTitleBar
				singleTab={!showTabStrip}
				tabStripLeaving={showTabStrip && !wantsTabStrip}
				allTabsOpen={allTabsOpen}
				onAllTabsOpenChange={setAllTabsOpen}
				showSidebarBadge={
					!sidebarOpen &&
					(showReadyCallout ||
						whatsNewVersion !== null ||
						telemetryConsent === "unset")
				}
				onNewTab={newTab}
			>
				{isFileOpen ? (
					<FileInfoBar scrollContainer={scrollContainerEl} onNewTab={newTab} />
				) : null}
			</WindowTitleBar>
			{/* Compact windows anchor the sidebar overlay to the window instead. */}
			<div className="relative -mt-px flex min-h-0 flex-1 overflow-hidden pt-px max-sm:static">
				{/* Compact sidebar stays mounted while closed so it can slide out. */}
				<div
					data-sidebar-overlay
					aria-hidden={!sidebarOpen}
					inert={!sidebarOpen}
					className={`${sidebarOpen ? SIDEBAR_OVERLAY_SHOWN : SIDEBAR_OVERLAY_HIDDEN} ${SIDEBAR_OVERLAY}`}
				>
					{compact ? <SidebarOverlayTitleRow /> : null}
					<Sidebar
						onFocusedItemChange={updateFocusedSidebarItem}
						footer={
							showReadyCallout ? (
								<SidebarCallout
									message={
										<>
											<span className="font-semibold">A new version</span> is
											ready to install.
										</>
									}
									primaryLabel="Restart"
									onPrimary={installUpdate}
									onDismiss={() =>
										setDismissedVersion(readyVersion ?? "__unknown__")
									}
								/>
							) : whatsNewVersion !== null ? (
								<SidebarCallout
									message={
										<>
											<span className="font-semibold">Hubble updated</span> to{" "}
											{whatsNewVersion}.
										</>
									}
									primaryLabel="See what's new"
									onPrimary={() => {
										// Only consume the one-shot callout once the changelog is
										// actually showing; openChangelog can bail on a conflict.
										void openChangelog().then((opened) => {
											if (opened) markWhatsNewSeen();
										});
									}}
									onDismiss={markWhatsNewSeen}
								/>
							) : telemetryConsent === "unset" ? (
								<TelemetryConsentCallout
									onChoose={(choice) => void setTelemetryConsent(choice)}
								/>
							) : undefined
						}
					/>
				</div>
				<section
					className={
						terminalPosition === "right"
							? "flex-1 flex flex-row overflow-hidden"
							: "flex-1 flex flex-col overflow-hidden"
					}
					aria-live="polite"
					onFocusCapture={closeSidebarOverlay}
				>
					<div className="flex-1 min-h-0 min-w-0 flex flex-col">
						{showTabStrip && isFileOpen ? (
							<FileInfoBar scrollContainer={scrollContainerEl} />
						) : null}
						<div data-note-body className="flex-1 min-h-0 min-w-0 relative">
							{state.status === "loading" && <p>Loading…</p>}
							{state.status === "error" && (
								<p>{state.error ?? "Failed to open file."}</p>
							)}
							{state.status !== "loading" &&
								state.status !== "error" &&
								!state.currentPath &&
								!hasWorkspace && (
									<div className="flex h-full items-center justify-center p-6">
										<WelcomeScreen
											onCreateFolder={() => void createWorkspaceWithSidebar()}
											onOpenFolder={() => void openWorkspaceWithSidebar()}
										/>
									</div>
								)}
							{/* With no tabs open, the blank page doubles as the empty state. */}
							{state.status !== "loading" &&
								state.status !== "error" &&
								(isNewTabPath(state.currentPath) ||
									(!state.currentPath && hasWorkspace)) && (
									<NewTabPage
										folder={focusedCreationFolder}
										onSearch={openSearch}
									/>
								)}
							{state.status === "ready" &&
								state.currentPath &&
								!isNewTabPath(state.currentPath) && (
									<div className="flex h-full min-h-0 flex-col">
										{state.externalChange.kind === "conflict" && (
											<ExternalChangeBanner
												onKeepMyEdits={() => void forceKeepLocalEdits()}
												onReloadFromDisk={reloadFromDiskConflict}
											/>
										)}
										<DocumentViewer
											path={state.currentPath}
											content={state.content}
											copyAsMarkdownRequest={copyAsMarkdownRequest}
											viewMode={state.viewMode}
											spellcheckStatus={spellcheckStatus}
											onScrollContainerChange={setScrollContainerEl}
										/>
									</div>
								)}
						</div>
					</div>
					<TerminalPanel />
				</section>
			</div>
			<GlobalSearchPalette
				open={searchOpen}
				onOpenChange={changeSearchOpen}
				files={paletteFiles}
				onSelectFile={(path) => void loadPath(path)}
				searchContents={searchFileContents}
				commands={paletteCommands}
				recentCommandIds={recentCommandIds}
				onRunCommand={recordRecentCommand}
			/>
			<Settings
				open={settingsOpen}
				target={settingsTarget}
				onOpenChange={changeSettingsOpen}
				updateState={updateState}
				onUpdateAction={() => void triggerPrimaryUpdateAction()}
				onViewChangelog={openWhatsNew}
			/>
			<SkippedSkillsDialog />
		</main>
	);
}

function DocumentViewer({
	path,
	content,
	copyAsMarkdownRequest,
	viewMode,
	spellcheckStatus,
	onScrollContainerChange,
}: {
	path: string;
	content: string;
	copyAsMarkdownRequest: number;
	viewMode: ViewMode;
	spellcheckStatus?: SpellcheckStatus | null;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
}) {
	const documentId = editorDocumentId(path);
	if (isDiagramFile(path)) {
		return <DiagramView key={path} path={path} content={content} />;
	}

	if (viewMode === "source" && supportsSourceToggle(path)) {
		const isHtml = hasHtmlExtension(path);
		return (
			<MarkdownSourceEditor
				key={`${documentId}:source:${HMR_REV}`}
				path={path}
				documentId={documentId}
				preserveHistoryOnUpdate={documentId !== path}
				initialMarkdown={content}
				sourceLanguage={
					isHtml ? "html" : hasTextExtension(path) ? "text" : "md"
				}
				onLocalChange={updateEditorContent}
				onSave={savePathContent}
				onScrollContainerChange={onScrollContainerChange}
			/>
		);
	}

	if (isCodeFile(path)) {
		return (
			<MarkdownSourceEditor
				key={`${path}:code:${HMR_REV}`}
				path={path}
				initialMarkdown={content}
				sourceLanguage={sourceLanguageForPath(path)}
				autoFocus={false}
				onLocalChange={updateEditorContent}
				onSave={savePathContent}
				onScrollContainerChange={onScrollContainerChange}
			/>
		);
	}

	if (hasTextExtension(path)) {
		return (
			<PlainTextEditor
				key={`${path}:rich:${HMR_REV}`}
				path={path}
				initialText={content}
				onLocalChange={updateEditorContent}
				onSave={savePathContent}
				onScrollContainerChange={onScrollContainerChange}
			/>
		);
	}

	if (hasHtmlExtension(path)) {
		return (
			<HtmlDocumentViewer
				// Remount on content change so the iframe reloads the updated file
				// from disk and a stale load error clears.
				key={`${path}:${content}`}
				path={path}
				content={content}
				onScrollContainerChange={onScrollContainerChange}
			/>
		);
	}

	if (hasImageExtension(path)) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-card p-6">
				<img
					className="block max-h-full max-w-full object-contain"
					src={toAssetUrl(path)}
					alt={relativeWorkspacePath(path, workspaceStore.get().workspacePath)}
				/>
			</div>
		);
	}

	if (hasPdfExtension(path)) {
		return (
			<iframe
				className="block min-h-0 flex-1 border-0 bg-card"
				src={toAssetUrl(path)}
				style={{ blockSize: "100%", inlineSize: "100%" }}
				title={relativeWorkspacePath(path, workspaceStore.get().workspacePath)}
			/>
		);
	}

	return (
		<MarkdownEditor
			key={`${documentId}:rich:${HMR_REV}`}
			path={path}
			documentId={documentId}
			initialMarkdown={content}
			copyAsMarkdownRequest={copyAsMarkdownRequest}
			spellcheckStatus={spellcheckStatus}
			onScrollContainerChange={onScrollContainerChange}
		/>
	);
}

function HtmlDocumentViewer({
	path,
	content,
	onScrollContainerChange,
}: {
	path: string;
	content: string;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
}) {
	const workspace = useStoreValue(workspaceStore);
	const [error, setError] = useState<string | null>(null);
	const isEmpty = content.trim().length === 0;

	useEffect(() => {
		onScrollContainerChange?.(null);
	}, [onScrollContainerChange]);

	// The open file's content updates live as the agent writes to disk, so swap
	// between the teaching empty state and the rendered app without reopening.
	if (isEmpty) {
		return (
			<HtmlAppEmptyState path={path} workspacePath={workspace.workspacePath} />
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
			{error ? (
				<p className="m-0 p-4 text-sm text-destructive">{error}</p>
			) : (
				<IframeView
					className="block min-h-0 flex-1 border-0 bg-card"
					htmlAppPath={path}
					onError={setError}
					src={toAssetUrl(path)}
					style={{ blockSize: "100%", inlineSize: "100%" }}
					title={relativeWorkspacePath(path, workspace.workspacePath)}
					workspacePath={workspace.workspacePath}
				/>
			)}
		</div>
	);
}

function ExternalChangeBanner({
	onReloadFromDisk,
	onKeepMyEdits,
}: {
	onReloadFromDisk: () => void;
	onKeepMyEdits: () => void;
}) {
	return (
		<div className="border-b border-border bg-muted/40">
			<div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
				<p className="m-0 text-sm text-muted-foreground">
					File changed on disk. Reload it or keep your editor edits.
				</p>
				<div className="flex shrink-0 items-center gap-2">
					<Button size="sm" variant="outline" onClick={onReloadFromDisk}>
						Reload from disk
					</Button>
					<Button size="sm" onClick={onKeepMyEdits}>
						Keep my edits
					</Button>
				</div>
			</div>
		</div>
	);
}

function MarkdownEditor({
	path,
	documentId,
	initialMarkdown,
	copyAsMarkdownRequest,
	spellcheckStatus,
	onScrollContainerChange,
}: {
	path: string;
	documentId: string;
	initialMarkdown: string;
	copyAsMarkdownRequest: number;
	spellcheckStatus?: SpellcheckStatus | null;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
}) {
	const workspace = useStoreValue(workspaceStore);
	const getPath = () => viewerStore.get().currentPath ?? path;
	// External-only files stay out of autocomplete; explicit links still work.
	const wikiTargets: WikiTarget[] = workspace.files
		.filter((file) => (file.kind ?? fileKindForPath(file.path)) !== "external")
		.map((file) => {
			const target = relativeWorkspacePath(file.path, workspace.workspacePath);
			return {
				path: file.path,
				target,
				title: wikiDisplayNameForTarget(target),
			};
		});
	const openExternalLink = async (href: string) => {
		if (classifyHref(href) === "external") {
			await desktopApi.openExternalUrl(href);
			return;
		}
		const resolved = resolveRelativeLinkPath({
			href,
			currentFilePath: path,
			workspacePath: workspace.workspacePath,
		});
		try {
			const result = await desktopApi.openPathFromLink(resolved);
			if (result.kind === "file") await loadPath(result.path);
		} catch (error) {
			if (error instanceof Error && error.message.includes("Open cancelled")) {
				return;
			}
			if (error instanceof Error && error.message.includes("FILE_NOT_FOUND")) {
				toast.error(`File not found: ${href.split("#", 1)[0] ?? href}`);
				return;
			}
			toast.error("Failed to open file", {
				description: error instanceof Error ? error.message : undefined,
			});
		}
	};
	return (
		<EditorView
			path={path}
			documentId={documentId}
			preserveHistoryOnUpdate={documentId !== path}
			initialMarkdown={initialMarkdown}
			editable={!isChangelogPath(path)}
			wikiTargets={wikiTargets}
			extensions={[
				createImageExtension(getPath),
				createEmbedExtension({
					workspacePath: workspace.workspacePath,
					getFilePath: getPath,
				}),
			]}
			onPaste={(editor, event) => handleImagePaste({ editor, event })}
			onDrop={(editor, event) => handleImageDrop({ editor, event })}
			onLocalChange={updateEditorContent}
			onSave={savePathContent}
			onScrollContainerChange={onScrollContainerChange}
			copyAsMarkdownRequest={copyAsMarkdownRequest}
			onOpenExternalLink={openExternalLink}
			onOpenWikiLink={(target) =>
				void loadPath(
					resolveWikiPath({
						target,
						files: workspace.files,
						workspacePath: workspace.workspacePath,
					}),
				)
			}
			onMessage={(message, kind) =>
				kind === "success" ? toast.success(message) : toast.error(message)
			}
			onReviewThreadsChange={setReviewThreads}
			spellcheckStatus={spellcheckStatus}
		/>
	);
}

export default App;
