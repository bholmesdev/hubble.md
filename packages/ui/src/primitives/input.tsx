import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "../lib/utils";

type InputProps = React.ComponentProps<"input"> & {
	variant?: "default" | "ghost";
};

function Input({ className, type, variant = "default", ...props }: InputProps) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-8 w-full min-w-0 rounded-sm px-2.5 py-1 text-[11px] outline-hidden file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[11px] file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				variant === "ghost"
					? "border border-transparent bg-transparent shadow-none inset-shadow-none focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0 aria-invalid:border-destructive"
					: "border border-input bg-card focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
