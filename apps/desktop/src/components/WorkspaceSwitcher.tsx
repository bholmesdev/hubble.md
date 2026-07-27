import { formatCommandShortcut, WorkspaceSwitcherMenu } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import MingcuteAddLine from "~icons/mingcute/add-line";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import { basename, dirname, duplicateBasenames } from "../lib/filePath";
import { tildePath } from "../lib/tildePath";
import {
	openWorkspace,
	removeRecentWorkspace,
	setWorkspaceSwitcherOpen,
} from "../store/actions";
import {
	recentWorkspacesStore,
	switcherOpenStore,
	workspacePathStore,
} from "../store/state";

export function WorkspaceSwitcher() {
	const workspacePath = useStoreValue(workspacePathStore);
	const recentWorkspaces = useStoreValue(recentWorkspacesStore);
	const open = useStoreValue(switcherOpenStore);
	if (!workspacePath) return null;
	const workspaceName = basename(workspacePath);
	const others = recentWorkspaces.filter((p) => p !== workspacePath);
	const duplicateNames = duplicateBasenames([workspacePath, ...others]);

	return (
		<WorkspaceSwitcherMenu
			label={workspaceName}
			title={`${tildePath(workspacePath)} (${formatCommandShortcut("app.open-folder")})`}
			open={open}
			onOpenChange={setWorkspaceSwitcherOpen}
		>
			<WorkspaceSwitcherMenu.Item
				selected
				title={tildePath(workspacePath)}
				data-workspace-path={workspacePath}
			>
				<span className="truncate">{workspaceName}</span>
			</WorkspaceSwitcherMenu.Item>
			{others.map((path) => {
				const name = basename(path);
				const parent = duplicateNames.has(name) ? dirname(path) : null;
				const remove = (origin: HTMLElement) => {
					const folderItems = Array.from(
						origin
							.closest('[role="menu"]')
							?.querySelectorAll<HTMLElement>("[data-workspace-path]") ?? [],
					);
					const index = folderItems.findIndex(
						(item) => item.dataset.workspacePath === path,
					);
					const nextItem = folderItems[index + 1] ?? folderItems[index - 1];
					removeRecentWorkspace(path);
					// The focused menu item is about to unmount. Move focus only
					// after React has rendered the shorter list.
					queueMicrotask(() => nextItem?.focus());
				};
				return (
					// The action lives inside the item so hovering it keeps the whole
					// row highlighted.
					<WorkspaceSwitcherMenu.Item
						key={path}
						title={tildePath(path)}
						data-workspace-path={path}
						aria-keyshortcuts="Delete Backspace"
						className="group relative pe-7"
						onClick={() => void openWorkspace(path)}
						onKeyDown={(event) => {
							if (event.key !== "Delete" && event.key !== "Backspace") return;
							event.preventDefault();
							remove(event.currentTarget);
						}}
					>
						<span className="min-w-0 shrink truncate">{name}</span>
						{parent && (
							<span className="ms-auto min-w-0 flex-1 truncate text-start text-muted-foreground [direction:rtl]">
								<bdi dir="ltr">{tildePath(parent)}</bdi>
							</span>
						)}
						<WorkspaceSwitcherMenu.Action
							title="Remove from list"
							data-remove-workspace={path}
							className="pointer-events-none absolute -translate-y-1/2 opacity-0 [inset-block-start:50%] [inset-inline-end:0.25rem] group-data-highlighted:pointer-events-auto group-data-highlighted:opacity-100"
							onClick={(event) => {
								// Do not let the row's own click open the workspace.
								event.stopPropagation();
								remove(event.currentTarget);
							}}
						>
							<MingcuteCloseLine className="size-3" />
						</WorkspaceSwitcherMenu.Action>
					</WorkspaceSwitcherMenu.Item>
				);
			})}
			<WorkspaceSwitcherMenu.Item
				icon={<MingcuteAddLine className="size-3 shrink-0" />}
				onClick={() => void openWorkspace()}
			>
				<span className="flex-1">Add folder...</span>
				<span
					className="ms-auto shrink-0 text-[11px] leading-none text-muted-foreground/60"
					aria-hidden="true"
				>
					{formatCommandShortcut("app.add-folder")}
				</span>
			</WorkspaceSwitcherMenu.Item>
		</WorkspaceSwitcherMenu>
	);
}
