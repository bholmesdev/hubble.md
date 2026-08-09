import { Menu } from "@base-ui/react/menu";
import type { ComponentProps, ReactNode } from "react";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteSelectorVerticalLine from "~icons/mingcute/selector-vertical-line";
import { cn } from "../lib/utils";

function Item({
	children,
	icon,
	selected,
	className,
	...props
}: Menu.Item.Props & { icon?: ReactNode; selected?: boolean }) {
	return (
		<Menu.Item
			{...props}
			className={cn(
				"flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-[11px] text-sidebar-foreground outline-hidden select-none data-highlighted:bg-accent",
				className,
			)}
		>
			{selected ? (
				<MingcuteCheckLine className="size-3 shrink-0 text-brand" />
			) : icon ? (
				icon
			) : (
				<span className="size-3 shrink-0" />
			)}
			{children}
		</Menu.Item>
	);
}

function Separator() {
	return <Menu.Separator className="my-1 h-px bg-border" />;
}

function Action({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			tabIndex={-1}
			aria-hidden="true"
			// Keep focus and selection on the menu item this sits inside.
			onMouseDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
			onPointerDown={(event) => event.stopPropagation()}
			{...props}
			className={cn(
				"flex cursor-pointer items-center justify-center rounded-sm p-1 text-muted-foreground outline-hidden select-none hover:text-sidebar-foreground",
				className,
			)}
		/>
	);
}

export function WorkspaceSwitcherMenu({
	label,
	title,
	open,
	onOpenChange,
	children,
}: {
	label: string;
	title?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	return (
		<Menu.Root open={open} onOpenChange={onOpenChange}>
			<Menu.Trigger
				className="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-0.5 rounded-sm py-1 ps-2 pe-1 hover:bg-muted"
				title={title}
			>
				<span className="truncate text-xs font-semibold text-sidebar-foreground">
					{label}
				</span>
				<MingcuteSelectorVerticalLine className="size-4 shrink-0 text-muted-foreground" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner
					data-sidebar-portal
					align="start"
					side="bottom"
					sideOffset={4}
					className="isolate z-50"
				>
					<Menu.Popup className="z-50 w-56 origin-(--transform-origin) rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						{children}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

WorkspaceSwitcherMenu.Item = Item;
WorkspaceSwitcherMenu.Action = Action;
WorkspaceSwitcherMenu.Separator = Separator;
