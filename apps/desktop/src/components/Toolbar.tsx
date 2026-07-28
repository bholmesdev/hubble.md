import { Menu } from "@base-ui/react/menu";
import {
	Button,
	commandReviewThread,
	formatShortcut,
	ReviewCommentSummary,
	Toolbar as SharedToolbar,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { type CSSProperties, useEffect, useState } from "react";
import { toast } from "sonner";
import MingcuteArrowLeftLine from "~icons/mingcute/arrow-left-line";
import MingcuteArrowRightLine from "~icons/mingcute/arrow-right-line";
import MingcuteCodeLine from "~icons/mingcute/code-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteExternalLinkLine from "~icons/mingcute/external-link-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import MingcuteRefresh2Line from "~icons/mingcute/refresh-2-line";
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
	relativeWorkspacePath,
	supportsSourceToggle,
} from "../lib/filePath";
import { revealFileLabel } from "../lib/revealFile";
import {
	goBack,
	goForward,
	openPathInDefaultApp,
	refreshFiles,
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
	viewerStore,
	workspacePathStore,
} from "../store/state";
import { ClaudeLogo, CodexLogo } from "./AgentLogos";

const dragRegionStyle = {
	WebkitAppRegion: "drag",
} as CSSProperties;

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
	const reviewThreads = useStoreValue(reviewThreadsStore);
	const isFullScreen = useIsFullScreen();
	// The changelog note is virtual: show a friendly title and disable the
	// file actions (rename, reveal, copy path) that assume a file on disk.
	const isChangelog = isChangelogPath(currentPath);

	return (
		<SharedToolbar
			currentPath={isChangelog ? "What's new" : (currentPath ?? null)}
			sidebarOpen={sidebarOpen}
			sidebarBadge={showSidebarBadge}
			scrollContainer={scrollContainer}
			platformInset={!isFullScreen}
			rootProps={{ style: dragRegionStyle }}
			onToggleSidebar={toggleSidebar}
			leftSlot={<NavigationControls />}
			onRenameCurrentPath={
				isChangelog
					? undefined
					: (nextName) => void renameCurrentMarkdownFile(nextName)
			}
			rightSlot={
				<div className="flex items-center gap-1">
					{workspacePath && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Refresh Folder"
							title="Refresh Folder"
							onClick={() => void refreshFiles()}
						>
							<MingcuteRefresh2Line className="size-3.5" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Toggle terminal"
						title="Toggle terminal"
						onClick={toggleTerminal}
					>
						<MingcuteTerminalLine className="size-3.5" />
					</Button>
					{currentPath && hasMarkdownExtension(currentPath) && (
						<ReviewCommentSummary
							filePath={currentPath}
							threads={reviewThreads}
							onCommand={commandReviewThread}
							onMessage={(message, kind) =>
								kind === "success"
									? toast.success(message)
									: toast.error(message)
							}
						/>
					)}
					{currentPath && !isChangelog && (
						<NoteActionsMenu
							path={currentPath}
							workspacePath={
								workspacePath && isEditableFile(currentPath)
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
	const backLabel = `Go Back (${formatShortcut("CmdOrCtrl+[")})`;
	const forwardLabel = `Go Forward (${formatShortcut("CmdOrCtrl+]")})`;
	return (
		<>
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
		</>
	);
}

function NoteActionsMenu({
	path,
	workspacePath,
}: {
	path: string;
	workspacePath: string | null;
}) {
	const { viewMode } = useStoreValue(viewerStore);
	const isSourceMode = viewMode === "source";
	const isHtml = hasHtmlExtension(path);
	const sourceModeLabel = isSourceMode
		? isHtml
			? "View app"
			: hasTextExtension(path)
				? "Edit plain text"
				: "Edit rich text"
		: "Edit source";

	async function revealFile() {
		try {
			await desktopApi.revealFile(path);
		} catch {
			toast.error("Failed to reveal file");
		}
	}

	async function copyFilePath() {
		await copyText(path, "File path");
	}

	async function openInAgent(client: AgentClient) {
		if (!workspacePath) return;
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
						{workspacePath && (
							<>
								<Menu.Item
									className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
									onClick={requestChatAboutNote}
								>
									<MingcuteTerminalLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Chat about this note</span>
									<ShortcutHint spec="CmdOrCtrl+Shift+J" />
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
						{supportsSourceToggle(path) && (
							<Menu.Item
								className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
								onClick={() => setViewerMode(isSourceMode ? "rich" : "source")}
							>
								<MingcuteCodeLine className="size-3 shrink-0" />
								<span className="min-w-0 flex-1">{sourceModeLabel}</span>
								<ShortcutHint spec="Alt+CmdOrCtrl+U" />
							</Menu.Item>
						)}
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
							<ShortcutHint spec="CmdOrCtrl+Alt+R" />
						</Menu.Item>
						<Menu.Item
							className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
							onClick={() => void copyFilePath()}
						>
							<MingcuteCopy2Line className="size-3 shrink-0" />
							<span className="min-w-0 flex-1">Copy file path</span>
							<ShortcutHint spec="CmdOrCtrl+Shift+C" />
						</Menu.Item>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

// Takes the "CmdOrCtrl+..." accelerator spec, not a display string, so call
// sites can't hardcode platform-specific glyphs.
function ShortcutHint({ spec }: { spec: string }) {
	return (
		<span
			className="ms-auto shrink-0 text-[11px] leading-none text-muted-foreground/60"
			aria-hidden="true"
		>
			{formatShortcut(spec)}
		</span>
	);
}
