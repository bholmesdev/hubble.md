import { useStoreValue } from "@simplestack/store/react";
import { voiceLevel } from "../store/voice";

export function VoiceMeter() {
	const level = useStoreValue(voiceLevel);
	return (
		<span
			aria-hidden="true"
			className="flex h-5 w-5 items-center justify-center gap-0.5 text-muted-foreground"
		>
			{[5, 16, 6].map((height) => (
				<span
					key={height}
					className="w-1 rounded-full bg-current transition-[height] duration-100 ease-out motion-reduce:transition-none"
					style={{ height: 4 + level * height }}
				/>
			))}
		</span>
	);
}
