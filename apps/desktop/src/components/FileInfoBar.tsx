import { Menu } from "@base-ui/react/menu";
import type { AppCommandId } from "@hubble.md/editor";
import {
	Button,
	commandReviewThread,
	EditableFileTitle,
	ReviewCommentSummary,
	type ReviewCommentSummaryProps,
	useCommandShortcut,
	useCommandShortcutLabel,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import MingcuteArrowLeftLine from "~icons/mingcute/arrow-left-line";
import MingcuteArrowRightLine from "~icons/mingcute/arrow-right-line";
import MingcuteCodeLine from "~icons/mingcute/code-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteDeleteLine from "~icons/mingcute/delete-line";
import MingcuteExternalLinkLine from "~icons/mingcute/external-link-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import MingcuteTerminalLine from "~icons/mingcute/terminal-line";
import { desktopApi } from "../desktopApi";
import type { AgentClient } from "../desktopApi/types";
import { isChangelogPath } from "../lib/changelogNote";
import { copyText } from "../lib/clipboard";
import {
	basename,
	dirname,
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
	deleteSidebarItems,
	goBack,
	goForward,
	openPathInDefaultApp,
	renameCurrentMarkdownFile,
	requestChatAboutNote,
	setViewerMode,
	toggleTerminal,
} from "../store/actions";
import { useHistoryNav } from "../store/hooks";
import {
	currentPathStore,
	isInWorkspace,
	reviewThreadsStore,
	titleGenerationPreviewStore,
	viewerStore,
	workspacePathStore,
} from "../store/state";
import { ClaudeLogo, CodexLogo } from "./AgentLogos";

const menuItemClass =
	"flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent";

export function FileInfoBar({
	scrollContainer,
}: {
	scrollContainer: HTMLDivElement | null;
}) {
	const workspacePath = useStoreValue(workspacePathStore);
	const currentPath = useStoreValue(currentPathStore);
	const titlePreview = useStoreValue(titleGenerationPreviewStore);
	const titlePath = filePathForTitlePreview(currentPath, titlePreview);
	const reviewThreads = useStoreValue(reviewThreadsStore);
	const compact = useCompactWindow();
	const [showBorder, setShowBorder] = useState(false);

	useEffect(() => {
		if (!scrollContainer) {
			setShowBorder(false);
			return;
		}
		const update = () => setShowBorder(scrollContainer.scrollTop > 0);
		update();
		scrollContainer.addEventListener("scroll", update, { passive: true });
		return () => scrollContainer.removeEventListener("scroll", update);
	}, [scrollContainer]);

	// The changelog note is virtual: show a friendly title and disable the
	// file actions (rename, reveal, copy path) that assume a file on disk.
	const isChangelog = isChangelogPath(currentPath);
	const folder =
		titlePath && !isChangelog
			? dirname(relativeWorkspacePath(titlePath, workspacePath ?? null))
			: null;
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
		<div
			key={currentPath ?? "empty"}
			data-file-info-bar
			className={`relative flex h-9 min-w-0 shrink-0 items-center overflow-hidden px-3 select-none after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-dashed ${showBorder ? "after:border-border" : "after:border-transparent"}`}
		>
			<div className="flex flex-[0_100_114px] items-center pe-4">
				{compact ? null : <NavigationControls />}
			</div>
			<div className="flex min-w-0 flex-auto items-center justify-center gap-1 [&>button]:px-0 [&>input]:px-0">
				{folder ? (
					<>
						<span
							className="min-w-0 max-w-[50%] truncate text-xs text-muted-foreground"
							title={folder}
						>
							{folder.split(/[\\/]/).join(" / ")}
						</span>
						<span
							aria-hidden="true"
							className="text-xs text-muted-foreground/60"
						>
							/
						</span>
					</>
				) : null}
				<EditableFileTitle
					currentPath={isChangelog ? "What's new" : (titlePath ?? null)}
					onRename={
						isChangelog
							? undefined
							: (nextName) => void renameCurrentMarkdownFile(nextName)
					}
				/>
			</div>
			<div className="flex flex-[0_100_114px] items-center justify-end ps-2">
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
					{comments ? <ReviewCommentSummary {...comments} /> : null}
					{(compact || actionPath) && (
						<ActionsMenu
							path={actionPath}
							canDelete={Boolean(
								actionPath && isInWorkspace(actionPath, workspacePath ?? null),
							)}
							showTerminal={compact}
							workspacePath={
								workspacePath && actionPath && isEditableFile(actionPath)
									? workspacePath
									: null
							}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function NavigationControls() {
	const { canGoBack, canGoForward } = useHistoryNav();
	const backLabel = useCommandShortcutLabel("Go Back", "app.go-back");
	const forwardLabel = useCommandShortcutLabel("Go Forward", "app.go-forward");
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
	path,
	canDelete,
	workspacePath,
	showTerminal,
}: {
	path: string | null;
	canDelete: boolean;
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
	const menuLabel = path ? "Note actions" : "More actions";

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

	function deleteFile() {
		if (!path || !canDelete || !window.confirm(`Delete ${basename(path)}?`))
			return;
		void deleteSidebarItems([{ kind: "file", path }]);
	}

	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={menuLabel}
						title={menuLabel}
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
						{showTerminal && (
							<>
								<Menu.Item className={menuItemClass} onClick={toggleTerminal}>
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
									className={menuItemClass}
									onClick={requestChatAboutNote}
								>
									<MingcuteTerminalLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Chat about this note</span>
									<ShortcutHint commandId="app.chat-about-note" />
								</Menu.Item>
								<Menu.Item
									className={menuItemClass}
									onClick={() => void openInAgent("codex")}
								>
									<CodexLogo className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Open in Codex</span>
								</Menu.Item>
								<Menu.Item
									className={menuItemClass}
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
								className={menuItemClass}
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
									className={menuItemClass}
									onClick={() => void openPathInDefaultApp(path)}
								>
									<MingcuteExternalLinkLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Open in default app</span>
								</Menu.Item>
								<Menu.Item
									className={menuItemClass}
									onClick={() => void revealFile()}
								>
									<MingcuteFolderOpenLine className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">
										{revealFileLabel(desktopApi.platform)}
									</span>
									<ShortcutHint commandId="app.reveal" />
								</Menu.Item>
								<Menu.Item
									className={menuItemClass}
									onClick={() => void copyFilePath()}
								>
									<MingcuteCopy2Line className="size-3 shrink-0" />
									<span className="min-w-0 flex-1">Copy file path</span>
									<ShortcutHint commandId="app.copy-path" />
								</Menu.Item>
								{canDelete ? (
									<>
										<Menu.Separator className="my-1 h-px bg-border" />
										<Menu.Item
											className={`${menuItemClass} text-destructive`}
											onClick={deleteFile}
										>
											<MingcuteDeleteLine className="size-3 shrink-0" />
											<span className="min-w-0 flex-1">Delete</span>
										</Menu.Item>
									</>
								) : null}
							</>
						)}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function ShortcutHint({ commandId }: { commandId: AppCommandId }) {
	const shortcut = useCommandShortcut(commandId);
	if (!shortcut) return null;
	return (
		<span
			className="ms-auto shrink-0 text-[11px] leading-none text-muted-foreground/60"
			aria-hidden="true"
		>
			{shortcut}
		</span>
	);
}

export function filePathForTitlePreview(
	currentPath: string | null | undefined,
	titlePreview: { path: string; previewPath: string } | null,
) {
	if (!currentPath || titlePreview?.path !== currentPath) return currentPath;
	return pathEquals(currentPath, titlePreview.previewPath)
		? currentPath
		: titlePreview.previewPath;
}
