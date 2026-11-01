import { Modal } from "@hubble.md/ui";
import { type ReactNode, useState } from "react";

export function SettingsDialog({
	open,
	onOpenChange,
	title,
	className,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	className?: string;
	children: ReactNode;
}) {
	const [scrollState, setScrollState] = useState({ title, scrolled: false });
	const scrolled = scrollState.title === title && scrollState.scrolled;

	return (
		<Modal
			open={open}
			onOpenChange={onOpenChange}
			title={
				<span className="grid h-12 w-full grid-cols-[10rem_minmax(0,1fr)] items-center">
					<span className="px-4">Settings</span>
					<span className="px-4">{title}</span>
				</span>
			}
			className={`overflow-hidden p-0 ${className ?? "max-w-xl"}`}
			headerClassName={`relative z-10 mb-0 h-12 items-center pr-2.5 [&>div:first-child]:flex-1 ${
				scrolled
					? "after:absolute after:right-0 after:bottom-0 after:left-40 after:border-b after:border-dashed after:border-border after:content-['']"
					: ""
			}`}
			contentClassName="mr-0 overflow-visible pr-0"
		>
			<div
				className="contents"
				onScrollCapture={(event) =>
					setScrollState({
						title,
						scrolled: (event.target as HTMLElement).scrollTop > 0,
					})
				}
			>
				{children}
			</div>
		</Modal>
	);
}

export function SettingsSection({
	title,
	description,
	action,
	children,
}: {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0">
			<div className="flex items-center justify-between gap-4">
				<div className="flex flex-col gap-0.5">
					<h3 className="text-[13px] font-medium">{title}</h3>
					{description ? (
						<p className="text-xs text-muted-foreground">{description}</p>
					) : null}
				</div>
				{action}
			</div>
			{children ? <div>{children}</div> : null}
		</section>
	);
}
