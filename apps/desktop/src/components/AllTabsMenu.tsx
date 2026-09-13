import { Menu } from "@base-ui/react/menu";
import { Button, useCommandShortcutLabel } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import type { CSSProperties, Ref } from "react";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteDownLine from "~icons/mingcute/down-line";
import { isChangelogPath } from "../lib/changelogNote";
import { basename, dirname, relativeWorkspacePath } from "../lib/filePath";
import { activateTab } from "../store/actions";
import {
	currentPathStore,
	tabsStore,
	workspacePathStore,
} from "../store/state";

const noDragStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

export function AllTabsMenu({
	open,
	onOpenChange,
	tabsCollapsed = false,
	triggerRef,
}: {
	open: boolean;
	tabsCollapsed?: boolean;
	triggerRef?: Ref<HTMLButtonElement>;
	onOpenChange: (open: boolean) => void;
}) {
	const tabs = useStoreValue(tabsStore);
	const workspacePath = useStoreValue(workspacePathStore);
	const onChangelog = useStoreValue(currentPathStore, isChangelogPath);
	const title = useCommandShortcutLabel("Show all tabs", "app.all-tabs");

	return (
		<Menu.Root open={open} onOpenChange={onOpenChange}>
			<Menu.Trigger
				render={
					<Button
						ref={triggerRef}
						variant="ghost"
						size="icon-sm"
						className="mx-1 shrink-0"
						style={noDragStyle}
						aria-label="Show all tabs"
						title={title}
					/>
				}
			>
				<MingcuteDownLine
					className={`size-4 ${tabsCollapsed ? "motion-safe:animate-[tab-menu-pulse_450ms_ease-in-out_2]" : ""}`}
				/>
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner
					align="end"
					side="bottom"
					sideOffset={4}
					className="isolate z-50"
				>
					<Menu.Popup
						aria-label="Open tabs"
						finalFocus={(interaction) => interaction === "keyboard"}
						className="max-h-[min(24rem,var(--available-height))] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-sm border border-border bg-popover p-1 text-xs text-popover-foreground outline-hidden"
						style={noDragStyle}
					>
						{tabs.order.length === 0 ? (
							<div className="px-2 py-1.5 text-muted-foreground">
								No open tabs
							</div>
						) : (
							<Menu.RadioGroup
								value={onChangelog ? "" : (tabs.activeTabId ?? "")}
								onValueChange={(id) => void activateTab(id)}
							>
								{tabs.order.map((id) => {
									const path = tabs.byId[id].path;
									return (
										<Menu.RadioItem
											key={id}
											value={id}
											closeOnClick
											title={path}
											className="flex h-11 cursor-pointer items-center gap-2 rounded-sm px-2 outline-hidden select-none data-highlighted:bg-accent"
										>
											<span className="size-4 shrink-0">
												<Menu.RadioItemIndicator>
													<MingcuteCheckLine className="size-4" />
												</Menu.RadioItemIndicator>
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate">{basename(path)}</span>
												<span className="block truncate text-[11px] text-muted-foreground">
													{dirname(
														relativeWorkspacePath(path, workspacePath ?? null),
													)}
												</span>
											</span>
										</Menu.RadioItem>
									);
								})}
							</Menu.RadioGroup>
						)}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}
