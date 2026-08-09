import { Menu } from "@base-ui/react/menu";
import type { AppCommandId } from "@hubble.md/editor";
import {
	Button,
	commandReviewThread,
	formatCommandShortcut,
	ReviewCommentSummary,
	type ReviewCommentSummaryProps,
	Toolbar as SharedToolbar,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { type CSSProperties, useEffect, useState } from "react";
import { toast } from "sonner";
import MingcuteArrowLeftLine from "~icons/mingcute/arrow-left-line";
import MingcuteArrowRightLine from "~icons/mingcute/arrow-right-line";
import MingcuteChat3Line from "~icons/mingcute/chat-3-line";
import MingcuteCodeLine from "~icons/mingcute/code-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteExternalLinkLine from "~icons/mingcute/external-link-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import MingcuteTerminalLine from "~icons/mingcute/terminal-line";
import { desktopApi } from "../desktopApi";
import type { AgentClient } from "../desktopApi/types";
import { isChangelogPath } from "../lib/changelogNote";
import { copyText } from "../lib/clipboard";
import {
	hasHtmlExtension,
	hasMarkdownExtension,
	hasTextExtension,
	isEditableFile,
	pathEquals,
	relativeWorkspacePath,
	supportsSourceToggle,
} from "../lib/filePath";
import { useCompactWindow } from "../lib/layout";
import { revealFileLabel } from "../lib/revealFile";
import {
	goBack,
	goForward,
	openPathInDefaultApp,
	renameCurrentMarkdownFile,
	requestChatAboutNote,
	setViewerMode,
	toggleSidebar,
	toggleTerminal,
} from "../store/actions";
import { useHistoryNav } from "../store/hooks";
import {
	currentPathStore,
	reviewThreadsStore,
	sidebarOpenStore,
	titleGenerationPreviewStore,
	viewerStore,
	workspacePathStore,
} from "../store/state";
import { ClaudeLogo, CodexLogo } from "./AgentLogos";

const dragRegionStyle = {
	WebkitAppRegion: "drag",
} as CSSProperties;

type TitlePreview = { path: string; previewPath: string } | null;

export function toolbarPathForTitlePreview(
	currentPath: string | null | undefined,
	titlePreview: TitlePreview,
) {
	if (!currentPath || titlePreview?.path !== currentPath) return currentPath;
	return pathEquals(currentPath, titlePreview.previewPath)
		? currentPath
		: titlePreview.previewPath;
}

// Traffic lights are hidden in fullscreen, so drop their reserved inset.
function useIsFullScreen() {
	const [isFullScreen, setIsFullScreen] = useState(false);
	useEffect(() => {
		void desktopApi.getFullScreen().then(setIsFullScreen);
		return desktopApi.onFullScreenChange(setIsFullScreen);
	}, []);
	return isFullScreen;
}

export function Toolbar({
	scrollContainer,
	showSidebarBadge = false,
}: {
	scrollContainer: HTMLDivElement | null;
	showSidebarBadge?: boolean;
}) {
	const workspacePath = useStoreValue(workspacePathStore);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const currentPath = useStoreValue(currentPathStore);
	const titlePreview = useStoreValue(titleGenerationPreviewStore);
	const reviewThreads = useStoreValue(reviewThreadsStore);
	const isFullScreen = useIsFullScreen();
	const compact = useCompactWindow();
	// The changelog note is virtual: show a friendly title and disable the
	// file actions (rename, reveal, copy path) that assume a file on disk.
	const isChangelog = isChangelogPath(currentPath);
	const toolbarPath = toolbarPathForTitlePreview(currentPath, titlePreview);
	const actionPath = currentPath && !isChangelog ? currentPath : null;
	const comments: ReviewCommentSummaryProps | null =
		currentPath && hasMarkdownExtension(currentPath)
			? {
					filePath: currentPath,
					threads: reviewThreads,
					onCommand: commandReviewThread,
					onMessage: (message, kind) =>
						kind === "success" ? toast.success(message) : toast.error(message),
				}
			: null;

	return (
		<SharedToolbar
			currentPath={isChangelog ? "What's new" : (toolbarPath ?? null)}
			sidebarOpen={sidebarOpen}
			sidebarOverlays={compact}
			sidebarBadge={showSidebarBadge}
			scrollContainer={scrollContainer}
			platformInset={!isFullScreen}
			rootProps={{ style: dragRegionStyle }}
			onToggleSidebar={toggleSidebar}
			leftSlot={compact ? null : <NavigationControls />}
			onMoveWindow={(x, y) => void desktopApi.moveWindow(x, y)}
			onRenameCurrentPath={
				isChangelog
					? undefined
					: (nextName) => void renameCurrentMarkdownFile(nextName)
			}
			rightSlot={
				<div className="flex items-center gap-1">
					{!compact && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Toggle terminal"
							title="Toggle terminal"
							onClick={toggleTerminal}
						>
							<MingcuteTerminalLine className="size-3.5" />
						</Button>
					)}
					{comments && !compact ? <ReviewCommentSummary {...comments} /> : null}
					{(compact || actionPath) && (
						<ActionsMenu
							comments={compact ? comments : null}
							path={actionPath}
							showTerminal={compact}
							workspacePath={
								workspacePath && actionPath && isEditableFile(actionPath)
									? workspacePath
									: null
							}
						/>
					)}
				</div>
			}
		/>
	);
}

function NavigationControls() {
	const { canGoBack, canGoForward } = useHistoryNav();
	const backLabel = `Go Back (${formatCommandShortcut("app.go-back")})`;
	const forwardLabel = `Go Forward (${formatCommandShortcut("app.go-forward")})`;
	return (
		<div className="flex items-center gap-1">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={backLabel}
				title={backLabel}
				disabled={!canGoBack}
				onClick={() => void goBack()}
			>
				<MingcuteArrowLeftLine className="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={forwardLabel}
				title={forwardLabel}
				disabled={!canGoForward}
				onClick={() => void goForward()}
			>
				<MingcuteArrowRightLine className="size-4" />
			</Button>
		</div>
	);
}

function ActionsMenu({
	comments,
	path,
	workspacePath,
	showTerminal,
}: {
	comments: ReviewCommentSummaryProps | null;
	path: string | null;
	workspacePath: string | null;
	showTerminal: boolean;
}) {
	const { viewMode } = useStoreValue(viewerStore);
	const isSourceMode = viewMode === "source";
	const sourceModeLabel = path
		? isSourceMode
			? hasHtmlExtension(path)
				? "View app"
				: hasTextExtension(path)
					? "Edit plain text"
					: "Edit rich text"
			: "Edit source"
		: null;

	async function revealFile() {
		if (!path) return;
		try {
			await desktopApi.revealFile(path);
		} catch {
			toast.error("Failed to reveal file");
		}
	}

	async function copyFilePath() {
		if (!path) return;
		await copyText(path, "File path");
	}

	async function openInAgent(client: AgentClient) {
		if (!path || !workspacePath) return;
		const clientName = client === "codex" ? "Codex" : "Claude";
		try {
			await desktopApi.openAgentClient({
				client,
				prompt: `Read ${relativeWorkspacePath(path, workspacePath)} and...`,
				workspacePath,
			});
		} catch (error) {
			toast.error(`Failed to open ${clientName}`, {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Note actions"
						title="Note actions"
					/>
				}
			>
				<MingcuteMore2Line className="size-4" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner
					align="end"
					side="bottom"
					sideOffset={4}
					className="isolate z-50"
				>
					<Menu.Popup className="z-50 w-52 origin-(--transform-origin) rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						{comments ? (
							<ReviewCommentSummary
								{...comments}
								triggerChildren={
									<>
										<MingcuteChat3Line className="size-3 shrink-0" />
										<span className="min-w-0 flex-1">Comments</span>
									</>
								}
								triggerNativeButton={false}
								triggerRole="menuitem"
								trigger={
									<Menu.Item
										closeOnClick={false}
										className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									/>
								}
							/>
						) : null}
						{showTerminal && (
							<>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={toggleTerminal}
								>
									<MingcuteTerminalLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Toggle terminal</span>
									<ShortcutHint commandId="app.toggle-terminal" />
								</Menu.Item>
								<Menu.Separator className="my-1 h-px bg-border" />
							</>
						)}
						{path && workspacePath && (
							<>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={requestChatAboutNote}
								>
									<MingcuteTerminalLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Chat about this note</span>
									<ShortcutHint commandId="app.chat-about-note" />
								</Menu.Item>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={() => void openInAgent("codex")}
								>
									<CodexLogo className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Open in Codex</span>
								</Menu.Item>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={() => void openInAgent("claude")}
								>
									<ClaudeLogo className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Open in Claude</span>
								</Menu.Item>
								<Menu.Separator className="my-1 h-px bg-border" />
							</>
						)}
						{path && supportsSourceToggle(path) && (
							<Menu.Item
								className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
								onClick={() => setViewerMode(isSourceMode ? "rich" : "source")}
							>
								<MingcuteCodeLine className="size-3 shrink-0" />
								<span className="min-w-0 flex-1">{sourceModeLabel}</span>
								<ShortcutHint commandId="app.toggle-source-mode" />
							</Menu.Item>
						)}
						{path && (
							<>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={() => void openPathInDefaultApp(path)}
								>
									<MingcuteExternalLinkLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Open in default app</span>
								</Menu.Item>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={() => void revealFile()}
								>
									<MingcuteFolderOpenLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">
										{revealFileLabel(desktopApi.platform)}
									</span>
									<ShortcutHint commandId="app.reveal" />
								</Menu.Item>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={() => void copyFilePath()}
								>
									<MingcuteCopy2Line className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Copy file path</span>
									<ShortcutHint commandId="app.copy-path" />
								</Menu.Item>
							</>
						)}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

// Stable IDs keep hints synchronized with command bindings.
function ShortcutHint({ commandId }: { commandId: AppCommandId }) {
	return (
		<span
			className="ms-auto shrink-0 text-[11px] leading-none text-muted-foreground/60"
			aria-hidden="true"
		>
			{formatCommandShortcut(commandId)}
		</span>
	);
}
