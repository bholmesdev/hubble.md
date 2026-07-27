import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "../lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent transition-[background-color,box-shadow] duration-[var(--default-transition-duration)] ease-snappy outline-hidden focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-input",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block size-3 rounded-full bg-background shadow-sm transition-transform duration-[var(--default-transition-duration)] ease-snappy data-checked:bg-primary-foreground data-checked:translate-x-3 data-unchecked:translate-x-0.5 rtl:data-checked:-translate-x-3 rtl:data-unchecked:-translate-x-0.5 dark:data-unchecked:bg-foreground"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
