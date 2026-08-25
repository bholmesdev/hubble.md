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
import { useCompactWindow } from "../lib/layout";
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
	openPathInDefaultApp,
	openWorkspace,
	renameFolder,
	renameMarkdownFile,
	setSidebarOpen,
	setSortMode,
	togglePinnedNote,
} from "../store/actions";
import {
	currentPathStore,
	sidebarOpenStore,
	workspaceStore,
} from "../store/state";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export type DesktopSidebarFocus = {
	kind: "file" | "folder";
	path: string;
} | null;

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
	const copyFilePath = (path: string) => copyText(path, "File path");

	return (
		<SharedSidebar
			files={files.map((file) => ({
				path: file.path,
				modifiedAt: file.modified_at,
				pinned: pinnedSet.has(file.path),
			}))}
			folders={folders.map((folder) => ({
				path: folder.path,
				modifiedAt: folder.modified_at,
			}))}
			currentPath={currentPath ?? null}
			sortMode={sortMode}
			storageScope={workspacePath}
			header={<WorkspaceSwitcher />}
			footer={footer}
			getDisplayPath={relativePath}
			onCollapse={collapseSidebar}
			onSortModeChange={setSortMode}
			onSelectFile={(path) => {
				void loadPath(path);
				if (compact) collapseSidebar();
			}}
			onOpenFileInDefaultApp={(path) => void openPathInDefaultApp(path)}
			onRevealFile={(path) => void desktopApi.revealFile(path)}
			onCopyFilePath={(path) => void copyFilePath(path)}
			onRevealFolder={(folderId) =>
				void desktopApi.revealFile(absolutePath(folderId))
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
			revealLabel={revealFileLabel(desktopApi.platform)}
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
			onTogglePinnedFile={(path) => void togglePinnedNote(path)}
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
		/>
	);
}
