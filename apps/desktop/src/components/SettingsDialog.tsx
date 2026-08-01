import { Modal } from "@hubble.md/ui";
import { type ReactNode, useState } from "react";

export type SettingsTab = "general" | "capture";

const TABS: { id: SettingsTab; label: string }[] = [
	{ id: "general", label: "General" },
	{ id: "capture", label: "Capture" },
];

export function SettingsDialog({
	open,
	onOpenChange,
	general,
	capture,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	general: ReactNode;
	capture: ReactNode;
}) {
	const [tab, setTab] = useState<SettingsTab>("general");

	return (
		<Modal
			open={open}
			onOpenChange={onOpenChange}
			title="Settings"
			className="max-w-xl"
		>
			<div
				role="tablist"
				aria-label="Settings sections"
				className="-mt-1 flex items-center gap-1 border-b border-border pb-2"
			>
				{TABS.map(({ id, label }) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
							tab === id
								? "bg-muted font-medium text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{label}
					</button>
				))}
			</div>
			<div className="flex flex-col divide-y divide-border">
				{tab === "general" ? general : capture}
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
