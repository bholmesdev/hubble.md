import { wikiDisplayNameForTarget } from "@hubble.md/editor";
import {
	Button,
	classifyHref,
	EditorView,
	GlobalSearchPalette,
	Input,
	MarkdownSourceEditor,
	type PaletteFile,
	PlainTextEditor,
	type WikiTarget,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { keymatch } from "keymatch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import MingcutePencilLine from "~icons/mingcute/pencil-line";
import { HtmlAppEmptyState } from "./components/HtmlAppEmptyState";
import { SettingsDialog, SettingsSection } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import {
	TelemetryConsentCallout,
	TelemetrySettingsSection,
} from "./components/TelemetrySection";
import { TerminalPanel } from "./components/TerminalPanel";
import { Toolbar } from "./components/Toolbar";
import { SidebarCallout, UpdatesSection } from "./components/UpdatesSection";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { desktopApi } from "./desktopApi";
import type {
	DesktopUpdateState,
	TelemetryChoice,
	TelemetryConsent,
} from "./desktopApi/types";
import { createEmbedExtension } from "./editor/EmbedExtension";
import { handleImageDrop, handleImagePaste } from "./editor/handleImagePaste";
import { IframeView, toAssetUrl } from "./editor/IframeView";
import { createImageExtension } from "./editor/ImageExtension";
import { createHtmlFile, createMarkdownFile } from "./fileActions";
import { isChangelogPath } from "./lib/changelogNote";
import { copyText } from "./lib/clipboard";
import {
	fileKindForPath,
	hasHtmlExtension,
	hasImageExtension,
	hasPdfExtension,
	hasTextExtension,
	isCodeFile,
	isEditableFile,
	relativeWorkspacePath,
	sourceLanguageForPath,
	supportsSourceToggle,
} from "./lib/filePath";
import { resolveRelativeLinkPath } from "./lib/relativeLinkPath";
import { resolveWikiPath } from "./lib/wikiPath";
import { SIDEBAR_NAV_SELECTOR } from "./selectors";
import {
	createWorkspaceWithSidebar,
	forceKeepLocalEdits,
	getPendingRenameTarget,
	goBack,
	goForward,
	handleExternalFileChange,
	loadPath,
	openChangelog,
	openWorkspace,
	openWorkspaceWithSidebar,
	refreshFiles,
	refreshFilesDebounced,
	reloadFromDiskConflict,
	requestChatAboutNote,
	savePathContent,
	setChatCommand,
	setCodeFileOpenMode,
	setLastSeenVersion,
	setSidebarOpen,
	setViewerMode,
	setWorkspaceSwitcherOpen,
	toggleTerminal,
	updateEditorContent,
} from "./store/actions";
import { canGoBack, canGoForward } from "./store/history";
import { useHistoryNav } from "./store/hooks";
import {
	chatCommandStore,
	codeFileOpenModeStore,
	lastSeenVersionStore,
	sidebarOpenStore,
	terminalPositionStore,
	uiStore,
	type ViewMode,
	viewerStore,
	workspacePathStore,
	workspaceStore,
} from "./store/state";

// Forces editor refresh when underlying TipTap extensions change
const HMR_REV = (() => {
	if (!import.meta.hot) return 0;
	const hotData = import.meta.hot.data as { __editorRev?: number };
	hotData.__editorRev = (hotData.__editorRev ?? 0) + 1;
	return hotData.__editorRev;
})();

function focusSidebarNav() {
	document.querySelector<HTMLElement>(SIDEBAR_NAV_SELECTOR)?.focus();
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
		(isChangelogPath(currentPath) ? null : currentPath) ??
		workspaceStore.get().workspacePath ??
		undefined;
	const selected = await desktopApi.openFilePicker({ defaultPath });
	if (typeof selected === "string") {
		await loadPath(selected);
	}
}

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
	const workspacePath = useStoreValue(workspacePathStore);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const terminalPosition = useStoreValue(terminalPositionStore);
	const hasWorkspace = workspacePath !== null;
	const { canGoBack: menuCanGoBack, canGoForward: menuCanGoForward } =
		useHistoryNav();
	const [scrollContainerEl, setScrollContainerEl] =
		useState<HTMLDivElement | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [copyAsMarkdownRequest, setCopyAsMarkdownRequest] = useState(0);
	const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(
		null,
	);
	const [telemetryConsent, setTelemetryConsent] =
		useState<TelemetryConsent | null>(null);
	const [focusedSidebarPath, setFocusedSidebarPath] = useState<string | null>(
		null,
	);
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const workspaceFiles = useStoreValue(workspaceStore).files;
	const paletteFiles: PaletteFile[] = workspaceFiles
		.filter((file) => (file.kind ?? fileKindForPath(file.path)) === "document")
		.map((file) => ({
			path: file.path,
			relativePath: relativeWorkspacePath(file.path, workspacePath ?? null),
			modifiedAt: file.modified_at,
		}));
	const lastSeenVersion = useStoreValue(lastSeenVersionStore);

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

	useEffect(() => {
		void desktopApi.getTelemetryConsent().then(setTelemetryConsent);
	}, []);

	const chooseTelemetry = async (choice: TelemetryChoice) => {
		setTelemetryConsent(await desktopApi.setTelemetryConsent(choice));
		if (choice !== "enabled") return;
		// Declining wiped today's record, so re-enabling must record the current
		// session again; an open HTML file counts as HTML App use.
		const viewer = viewerStore.get();
		void desktopApi.recordTelemetryActivity({
			usedHtmlApp:
				viewer.status === "ready" &&
				!!viewer.currentPath &&
				hasHtmlExtension(viewer.currentPath),
		});
	};

	useEffect(() => {
		// First install has no update to announce; just record the version.
		if (currentVersion && lastSeenVersion === null) {
			setLastSeenVersion(currentVersion);
		}
	}, [currentVersion, lastSeenVersion]);

	const openWhatsNew = () => {
		setSettingsOpen(false);
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
			isChangelogPath(currentPath) ||
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
			hasSourceViewOpen:
				typeof currentPath === "string" && supportsSourceToggle(currentPath),
			isSourceMode: state.viewMode === "source",
			canGoBack: menuCanGoBack,
			canGoForward: menuCanGoForward,
		});
	}, [
		hasWorkspace,
		menuCanGoBack,
		menuCanGoForward,
		state.currentPath,
		state.viewMode,
	]);

	useEffect(() => {
		if (!sidebarOpen) setFocusedSidebarPath(null);
	}, [sidebarOpen]);

	useEffect(() => {
		const onKeyDown = async (event: KeyboardEvent) => {
			if (keymatch(event, "CmdOrCtrl+[")) {
				if (!canGoBack()) return;
				event.preventDefault();
				await goBack();
			} else if (keymatch(event, "CmdOrCtrl+]")) {
				if (!canGoForward()) return;
				event.preventDefault();
				await goForward();
			} else if (keymatch(event, "CmdOrCtrl+N")) {
				event.preventDefault();
				await createMarkdownFile();
			} else if (keymatch(event, "CmdOrCtrl+,")) {
				event.preventDefault();
				setSettingsOpen(true);
			} else if (keymatch(event, "CmdOrCtrl+Shift+O")) {
				if (!workspaceStore.get().workspacePath) return;
				event.preventDefault();
				setWorkspaceSwitcherOpen(true);
			} else if (keymatch(event, "CmdOrCtrl+P")) {
				if (!workspaceStore.get().workspacePath) return;
				event.preventDefault();
				// The File menu accelerator fires too, but opening is idempotent.
				setSearchOpen(true);
			} else if (keymatch(event, "CmdOrCtrl+Shift+N")) {
				event.preventDefault();
				await openWorkspaceWithSidebar();
			} else if (keymatch(event, "CmdOrCtrl+O")) {
				event.preventDefault();
				await openFilePicker();
			} else if (keymatch(event, "CmdOrCtrl+Shift+C")) {
				const path = focusedSidebarPath ?? viewerStore.get().currentPath;
				if (!path || isChangelogPath(path)) return;
				event.preventDefault();
				await copyFilePath(path);
			} else if (keymatch(event, "CmdOrCtrl+Alt+R")) {
				const path = focusedSidebarPath ?? viewerStore.get().currentPath;
				if (!path || isChangelogPath(path)) return;
				event.preventDefault();
				await revealPath(path);
			} else if (keymatch(event, "CmdOrCtrl+Shift+J")) {
				const chatPath = viewerStore.get().currentPath;
				if (
					!chatPath ||
					!isEditableFile(chatPath) ||
					!workspaceStore.get().workspacePath
				)
					return;
				event.preventDefault();
				requestChatAboutNote();
			} else if (keymatch(event, "CmdOrCtrl+Shift+E")) {
				event.preventDefault();
				const opening = !uiStore.get().sidebarOpen;
				setSidebarOpen(opening);
				if (opening) {
					requestAnimationFrame(() => focusSidebarNav());
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [focusedSidebarPath]);

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
			desktopApi.onMenuCreateMarkdownFile(() => void createMarkdownFile()),
			desktopApi.onMenuCreateHtmlFile(() => void createHtmlFile()),
			desktopApi.onMenuOpenFile(() => void openFilePicker()),
			desktopApi.onMenuOpenFolder(() => void openWorkspaceWithSidebar()),
			desktopApi.onMenuOpenSettings(() => setSettingsOpen(true)),
			desktopApi.onMenuOpenChangelog(() => {
				setSettingsOpen(false);
				void openChangelog();
			}),
			desktopApi.onMenuCopyAsMarkdown(() =>
				setCopyAsMarkdownRequest((request) => request + 1),
			),
			desktopApi.onMenuShowWorkspaceSwitcher(() =>
				setWorkspaceSwitcherOpen(true),
			),
			desktopApi.onMenuGoToFile(() => setSearchOpen(true)),
			desktopApi.onMenuSyncWorkspace(() => void refreshFiles()),
			desktopApi.onMenuToggleTerminal(() => toggleTerminal()),
			desktopApi.onMenuGoBack(() => void goBack()),
			desktopApi.onMenuGoForward(() => void goForward()),
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
	}, []);

	useEffect(() => {
		// Window focus can fire in bursts when switching apps, so debounce the
		// sidebar refresh and keep the editor interactive while it runs.
		const dispose = desktopApi.onWindowFocus(() => refreshFilesDebounced());
		return () => {
			dispose();
		};
	}, []);

	useEffect(() => {
		let active = true;
		const init = async () => {
			const launchPath = await desktopApi.getLaunchFilePath();
			if (!active) return;

			if (typeof launchPath === "string" && launchPath.length > 0) {
				await loadPath(launchPath);
				return;
			}
			const launchWorkspacePath = await desktopApi.getLaunchWorkspacePath();
			if (!active) return;

			if (
				typeof launchWorkspacePath === "string" &&
				launchWorkspacePath.length > 0
			) {
				await openWorkspace(launchWorkspacePath);
				setSidebarOpen(true);
				return;
			}
			const nextState = viewerStore.get();
			const workspace = workspaceStore.get();
			const lastPath =
				nextState.lastOpenedPath ??
				(workspace.workspacePath
					? workspace.lastOpenedPaths[workspace.workspacePath]
					: undefined);
			if (lastPath) {
				// Restore must stay in Hubble: missing files stay quiet, and a code-file
				// preference must not launch another app during startup.
				await loadPath(lastPath, {
					missing: "silent",
					launchExternal: false,
				});
			}
		};
		void init();
		return () => {
			active = false;
		};
	}, []);

	return (
		<main className="flex h-dvh flex-col bg-background text-foreground">
			<Toolbar
				scrollContainer={scrollContainerEl}
				showSidebarBadge={
					!sidebarOpen &&
					(showReadyCallout ||
						whatsNewVersion !== null ||
						telemetryConsent === "unset")
				}
			/>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<Sidebar
					onFocusedPathChange={setFocusedSidebarPath}
					footer={
						// A pending restart outranks the what's-new nudge.
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
								onChoose={(choice) => void chooseTelemetry(choice)}
							/>
						) : undefined
					}
				/>
				<section
					className={
						terminalPosition === "right"
							? "flex-1 flex flex-row overflow-hidden"
							: "flex-1 flex flex-col overflow-hidden"
					}
					aria-live="polite"
				>
					<div className="flex-1 min-h-0 min-w-0 relative">
						{state.status === "loading" && <p>Loading…</p>}
						{state.status === "error" && (
							<p>{state.error ?? "Failed to open file."}</p>
						)}
						{state.status !== "loading" &&
							state.status !== "error" &&
							!state.currentPath && (
								<div className="flex h-full items-center justify-center p-6">
									{hasWorkspace ? (
										<Button onClick={() => void openFilePicker()}>
											Open file
										</Button>
									) : (
										<WelcomeScreen
											onCreateFolder={() => void createWorkspaceWithSidebar()}
											onOpenFolder={() => void openWorkspaceWithSidebar()}
										/>
									)}
								</div>
							)}
						{state.status === "ready" && state.currentPath && (
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
									onScrollContainerChange={setScrollContainerEl}
								/>
							</div>
						)}
					</div>
					<TerminalPanel />
				</section>
			</div>
			<GlobalSearchPalette
				open={searchOpen}
				onOpenChange={setSearchOpen}
				files={paletteFiles}
				onSelectFile={(path) => void loadPath(path)}
				searchContents={searchFileContents}
			/>
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
				<CodeFilesSettingsSection />
				<ChatAboutNoteSettingsSection />
				{telemetryConsent ? (
					<TelemetrySettingsSection
						consent={telemetryConsent}
						onChoose={(choice) => void chooseTelemetry(choice)}
					/>
				) : null}
				{updateState ? (
					<UpdatesSection
						state={updateState}
						onPrimaryAction={() => void triggerPrimaryUpdateAction()}
						onViewChangelog={openWhatsNew}
					/>
				) : null}
			</SettingsDialog>
		</main>
	);
}

function CodeFilesSettingsSection() {
	const mode = useStoreValue(codeFileOpenModeStore);
	return (
		<SettingsSection
			title="Code files"
			description="Choose where code files (JavaScript, Python, etc) are opened."
		>
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					variant={mode === "hubble" ? "secondary" : "outline"}
					aria-pressed={mode === "hubble"}
					onClick={() => setCodeFileOpenMode("hubble")}
				>
					Hubble
				</Button>
				<Button
					size="sm"
					variant={mode === "default-app" ? "secondary" : "outline"}
					aria-pressed={mode === "default-app"}
					onClick={() => setCodeFileOpenMode("default-app")}
				>
					Default app
				</Button>
			</div>
		</SettingsSection>
	);
}

function ChatAboutNoteSettingsSection() {
	const [draft, setDraft] = useState(() => chatCommandStore.get());

	return (
		<SettingsSection
			title="Chat about this note"
			description={`This command runs in a new terminal when you pick "Chat about this note" from a note's ⋯ menu. The shell replaces $HUBBLE_NOTE_PATH with the current note's file path.`}
		>
			<div className="relative">
				<Input
					className="font-mono pe-8"
					spellCheck={false}
					value={draft}
					onChange={(event) => {
						setDraft(event.currentTarget.value);
						setChatCommand(event.currentTarget.value);
					}}
				/>
				<MingcutePencilLine className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
			</div>
		</SettingsSection>
	);
}

function DocumentViewer({
	path,
	content,
	copyAsMarkdownRequest,
	viewMode,
	onScrollContainerChange,
}: {
	path: string;
	content: string;
	copyAsMarkdownRequest: number;
	viewMode: ViewMode;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
}) {
	if (viewMode === "source" && supportsSourceToggle(path)) {
		const isHtml = hasHtmlExtension(path);
		return (
			<MarkdownSourceEditor
				key={`${path}:source:${HMR_REV}`}
				path={path}
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
			key={`${path}:rich:${HMR_REV}`}
			path={path}
			initialMarkdown={content}
			copyAsMarkdownRequest={copyAsMarkdownRequest}
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
	initialMarkdown,
	copyAsMarkdownRequest,
	onScrollContainerChange,
}: {
	path: string;
	initialMarkdown: string;
	copyAsMarkdownRequest: number;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
}) {
	const workspace = useStoreValue(workspaceStore);
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
			initialMarkdown={initialMarkdown}
			editable={!isChangelogPath(path)}
			wikiTargets={wikiTargets}
			extensions={[
				createImageExtension(path),
				createEmbedExtension({
					workspacePath: workspace.workspacePath,
					filePath: path,
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
		/>
	);
}

export default App;
