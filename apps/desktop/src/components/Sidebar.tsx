import {
	Button,
	Sidebar as SharedSidebar,
	type SidebarFocusedItem,
	SidebarFrame,
} from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import type { ReactNode } from "react";
import { desktopApi } from "../desktopApi";
import { focusMarkdownEditorAfterRender } from "../fileActions";
import { copyText } from "../lib/clipboard";
import { isCompactWindow, useCompactWindow } from "../lib/layout";
import { revealFileLabel } from "../lib/revealFile";
import {
	createFolderInFolder,
	createHtmlFileInFolder,
	createMarkdownFileInFolder,
	deleteFolder,
	deleteMarkdownFile,
	deleteSidebarItems,
	loadPath,
	moveSidebarItems,
	openBackgroundTab,
	openPathInDefaultApp,
	openTabForPath,
	openWorkspace,
	renameFolder,
	renameMarkdownFile,
	setSidebarOpen,
	setSidebarView,
	setSortMode,
	togglePinnedNote,
} from "../store/actions";
import {
	currentPathStore,
	sidebarOpenStore,
	sidebarViewStore,
	workspaceStore,
} from "../store/state";
import { InboxView, SidebarViewToggle } from "./InboxView";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export type DesktopSidebarFocus = {
	kind: "file" | "folder";
	path: string;
} | null;

// File handlers live at module level so their identity never changes: inbox
// rows are memoized on them, and a new object per render would re-render
// every row on each autosave.
function collapseInCompactWindow() {
	if (isCompactWindow()) setSidebarOpen(false);
}

function selectFile(path: string, options?: { keepSidebarOpen: boolean }) {
	void loadPath(path);
	if (!options?.keepSidebarOpen) collapseInCompactWindow();
}

function openFileInNewTab(path: string) {
	void openTabForPath(path);
	collapseInCompactWindow();
}

const fileActions = {
	onOpenFileInNewTab: openFileInNewTab,
	onOpenFileInDefaultApp: (path: string) => void openPathInDefaultApp(path),
	onRevealFile: (path: string) => void desktopApi.revealFile(path),
	revealLabel: revealFileLabel(desktopApi.platform),
	onCopyFilePath: (path: string) => void copyText(path, "File path"),
	onTogglePinnedFile: (path: string) => void togglePinnedNote(path),
	onDeleteFile: (path: string) =>
		void deleteSidebarItems([{ kind: "file", path }]),
};

export function Sidebar({
	footer,
	onFocusedItemChange,
}: {
	footer?: ReactNode;
	onFocusedItemChange?: (item: DesktopSidebarFocus) => void;
}) {
	const workspace = useStoreValue(workspaceStore);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const currentPath = useStoreValue(currentPathStore);
	const sidebarView = useStoreValue(sidebarViewStore);
	const compact = useCompactWindow();
	const { workspacePath, files, folders, pinnedNotes, sortMode } = workspace;
	const pinnedSet = new Set(pinnedNotes);

	if (!sidebarOpen && !compact) return null;
	const collapseSidebar = () => setSidebarOpen(false);
	if (!workspacePath) {
		return (
			<SidebarFrame onCollapse={collapseSidebar}>
				<div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 px-3 text-sm">
					<div className="flex flex-col gap-1">
						<p className="font-medium text-sidebar-foreground">
							No folder selected
						</p>
						<p className="text-sidebar-foreground/70">
							Add a folder to browse files.
						</p>
					</div>
					<Button size="sm" onClick={() => void openWorkspace()}>
						Open folder
					</Button>
				</div>
				{footer ? (
					<div className="border-t border-sidebar-border p-2">{footer}</div>
				) : null}
			</SidebarFrame>
		);
	}

	const relativePath = (absPath: string) => {
		const prefix = workspacePath.endsWith("/")
			? workspacePath
			: `${workspacePath}/`;
		return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
	};
	const absolutePath = (displayPath: string | null) => {
		if (!displayPath) return workspacePath;
		const normalized = displayPath.replace(/\/+$/, "");
		return workspacePath.endsWith("/")
			? `${workspacePath}${normalized}`
			: `${workspacePath}/${normalized}`;
	};

	return (
		<SharedSidebar
			files={files.map((file) => ({
				path: file.path,
				modifiedAt: file.modified_at,
				pinned: pinnedSet.has(file.path),
			}))}
			folders={folders.map((folder) => ({
				path: folder.path,
			}))}
			currentPath={currentPath ?? null}
			sortMode={sortMode}
			storageScope={workspacePath}
			header={<WorkspaceSwitcher />}
			// Wide windows show the view toggle in the title bar above the sidebar.
			viewToggle={
				compact ? (
					<SidebarViewToggle view={sidebarView} onChange={setSidebarView} />
				) : undefined
			}
			footer={footer}
			getDisplayPath={relativePath}
			onCollapse={collapseSidebar}
			onSortModeChange={setSortMode}
			onSelectFile={selectFile}
			onOpenFileInNewTab={(path, options) => {
				if (options?.background) {
					void openBackgroundTab(path);
				} else {
					openFileInNewTab(path);
				}
			}}
			onOpenFileInDefaultApp={fileActions.onOpenFileInDefaultApp}
			onRevealFile={fileActions.onRevealFile}
			onCopyFilePath={fileActions.onCopyFilePath}
			onRevealFolder={(folderId) =>
				void desktopApi.revealFile(absolutePath(folderId))
			}
			onCopyFolderPath={(folderId) =>
				void copyText(absolutePath(folderId), "Folder path")
			}
			onFocusedItemChange={(item: SidebarFocusedItem) => {
				if (!item) {
					onFocusedItemChange?.(null);
					return;
				}
				onFocusedItemChange?.({
					kind: item.kind,
					path: item.kind === "file" ? item.path : absolutePath(item.folderId),
				});
			}}
			revealLabel={fileActions.revealLabel}
			onRenameFile={(path, nextName, { origin, commit }) => {
				void renameMarkdownFile(path, nextName).then((renamedPath) => {
					if (origin === "new-note" && commit === "enter" && renamedPath) {
						focusMarkdownEditorAfterRender(renamedPath);
					}
				});
			}}
			onRenameFolder={(folderId, nextName, targetDisplayPath) =>
				void renameFolder(
					absolutePath(folderId),
					nextName,
					absolutePath(targetDisplayPath),
				)
			}
			onDeleteFile={(path) => void deleteMarkdownFile(path)}
			onDeleteItems={(items) =>
				void deleteSidebarItems(
					items.map((item) =>
						item.kind === "file"
							? item
							: { ...item, folderId: absolutePath(item.folderId) },
					),
				)
			}
			onTogglePinnedFile={fileActions.onTogglePinnedFile}
			onCreateFile={(folderId) =>
				createMarkdownFileInFolder(absolutePath(folderId))
			}
			onCreateHtmlFile={(folderId) =>
				createHtmlFileInFolder(absolutePath(folderId))
			}
			onCreateFolder={(folderId) =>
				createFolderInFolder(absolutePath(folderId))
			}
			onDeleteFolder={(folderId) => void deleteFolder(absolutePath(folderId))}
			onMoveItem={({ items, targetFolderId }) =>
				void moveSidebarItems(items, absolutePath(targetFolderId))
			}
		>
			{sidebarView === "inbox" ? (
				<InboxView
					workspacePath={workspacePath}
					files={files}
					pinnedNotes={pinnedNotes}
					currentPath={currentPath ?? null}
					onOpen={selectFile}
					actions={fileActions}
				/>
			) : null}
		</SharedSidebar>
	);
}
