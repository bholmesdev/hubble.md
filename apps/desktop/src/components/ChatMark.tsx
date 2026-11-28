import MingcuteQuoteLeftFill from "~icons/mingcute/quote-left-fill";

export function ChatMark() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			className="mx-auto mb-1 size-12 text-muted-foreground"
		>
			<path
				d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 3v-3a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"
				fill="currentColor"
			/>
			<MingcuteQuoteLeftFill
				x="6"
				y="5"
				width="12"
				height="12"
				className="text-background"
			/>
		</svg>
	);
}
