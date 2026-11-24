import type { ReactNode } from "react";

export function EmptyStateAction({
	icon,
	label,
	detail,
	trailing,
	shortcut,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	detail?: string;
	trailing?: string;
	shortcut?: string | null;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-new-tab-option
			onClick={onClick}
			className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
		>
			<span className="text-muted-foreground">{icon}</span>
			<span className="truncate">{label}</span>
			{detail && (
				<span className="truncate text-xs text-muted-foreground">{detail}</span>
			)}
			{trailing && (
				<span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
					{trailing}
				</span>
			)}
			{shortcut && (
				<EmptyStateKbd className="ms-auto">{shortcut}</EmptyStateKbd>
			)}
		</button>
	);
}

export function EmptyStateKbd({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<kbd
			className={`shrink-0 rounded-[var(--radius-inner)] border border-border px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground ${className ?? ""}`}
		>
			{children}
		</kbd>
	);
}
