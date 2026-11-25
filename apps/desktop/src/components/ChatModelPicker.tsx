import { Select } from "@base-ui/react/select";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteDownLine from "~icons/mingcute/down-line";
import type { ChatModel } from "../desktopApi/chat";

export function ChatModelPicker({
	models,
	value,
	disabled,
	onValueChange,
}: {
	models: ChatModel[];
	value: string;
	disabled: boolean;
	onValueChange: (value: string) => void;
}) {
	return (
		<Select.Root
			value={value}
			disabled={disabled}
			items={models.map((model) => ({ value: model.slug, label: model.name }))}
			onValueChange={(next) => {
				if (next) onValueChange(next);
			}}
		>
			<Select.Trigger
				aria-label="Chat model"
				className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-xs border-0 bg-transparent py-1.5 text-xs text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
			>
				<Select.Value className="truncate" />
				<Select.Icon className="shrink-0">
					<MingcuteDownLine className="size-3.5" />
				</Select.Icon>
			</Select.Trigger>
			<Select.Portal>
				<Select.Positioner
					side="top"
					align="start"
					sideOffset={8}
					alignItemWithTrigger={false}
					className="isolate z-50"
				>
					<Select.Popup className="z-50 max-h-72 min-w-40 max-w-[min(20rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-y-auto rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						{models.map((model) => (
							<Select.Item
								key={model.slug}
								value={model.slug}
								title={model.name}
								className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start outline-hidden select-none data-highlighted:bg-accent"
							>
								<Select.ItemIndicator className="inline-flex" keepMounted>
									<MingcuteCheckLine className="size-3 opacity-0 [[data-selected]_&]:opacity-100" />
								</Select.ItemIndicator>
								<Select.ItemText className="min-w-0 truncate">
									{model.name}
								</Select.ItemText>
							</Select.Item>
						))}
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}
