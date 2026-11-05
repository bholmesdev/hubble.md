import { Button } from "@hubble.md/ui";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import { copyText } from "../lib/clipboard";

export function CopyBlock({
	value,
	display,
	label,
	ariaLabel,
}: {
	value: string;
	display?: string;
	label: string;
	ariaLabel: string;
}) {
	return (
		<div className="flex items-start gap-2 rounded-sm border border-border bg-muted/40 p-2">
			<code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
				{display ?? value}
			</code>
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label={ariaLabel}
				onClick={() => void copyText(value, label)}
			>
				<MingcuteCopy2Line />
			</Button>
		</div>
	);
}
