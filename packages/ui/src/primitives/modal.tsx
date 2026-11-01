import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import { cn } from "../lib/utils";
import { Button } from "./button";

type Props = {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	title: ReactNode;
	description?: string;
	className?: string;
	headerClassName?: string;
	contentClassName?: string;
	children: ReactNode;
};

function Modal({
	open,
	onOpenChange,
	title,
	description,
	className,
	headerClassName,
	contentClassName,
	children,
}: Props) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] opacity-100 transition-opacity duration-200 ease-snappy data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
				<Dialog.Popup
					className={cn(
						"fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-4rem)] w-full max-w-md -translate-x-1/2 -translate-y-1/2 scale-100 flex-col rounded-sm border border-border bg-popover p-4 text-popover-foreground opacity-100 shadow-overlay outline-hidden transition-[translate,scale,opacity] duration-300 ease-snappy data-[ending-style]:-translate-y-[calc(50%-8px)] data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:-translate-y-[calc(50%-8px)] data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
						className,
					)}
				>
					<div
						className={cn(
							"mb-3 flex shrink-0 items-start justify-between gap-3",
							headerClassName,
						)}
					>
						<div className="flex min-w-0 flex-col gap-1">
							<Dialog.Title className="m-0 text-sm font-semibold">
								{title}
							</Dialog.Title>
							{description && (
								<Dialog.Description className="m-0 text-xs text-muted-foreground">
									{description}
								</Dialog.Description>
							)}
						</div>
						<Dialog.Close
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Close"
									type="button"
								>
									<MingcuteCloseLine />
								</Button>
							}
						/>
					</div>
					<div
						className={cn(
							"-mr-2 min-h-0 flex-1 overflow-y-auto pr-2",
							contentClassName,
						)}
					>
						{children}
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export { Modal };
