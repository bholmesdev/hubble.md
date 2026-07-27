import { formatShortcut, WorkspaceSwitcherMenu } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import MingcuteAddLine from "~icons/mingcute/add-line";
import { basename, dirname, duplicateBasenames } from "../lib/filePath";
import { tildePath } from "../lib/tildePath";
import { openWorkspace, setWorkspaceSwitcherOpen } from "../store/actions";
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
			title={`${tildePath(workspacePath)} (${formatShortcut("CmdOrCtrl+Shift+O")})`}
			open={open}
			onOpenChange={setWorkspaceSwitcherOpen}
		>
			<WorkspaceSwitcherMenu.Item selected title={tildePath(workspacePath)}>
				<span className="truncate">{workspaceName}</span>
			</WorkspaceSwitcherMenu.Item>
			{others.map((path) => {
				const name = basename(path);
				const parent = duplicateNames.has(name) ? dirname(path) : null;
				return (
					<WorkspaceSwitcherMenu.Item
						key={path}
						title={tildePath(path)}
						onClick={() => void openWorkspace(path)}
					>
						<span className="min-w-0 shrink truncate">{name}</span>
						{parent && (
							<span className="ms-auto min-w-0 flex-1 truncate text-start text-muted-foreground [direction:rtl]">
								<bdi dir="ltr">{tildePath(parent)}</bdi>
							</span>
						)}
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
					{formatShortcut("CmdOrCtrl+Shift+N")}
				</span>
			</WorkspaceSwitcherMenu.Item>
		</WorkspaceSwitcherMenu>
	);
}
