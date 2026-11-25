import { useStoreValue } from "@simplestack/store/react";
import { voiceLevel } from "../store/voice";

export function VoiceMeter() {
	const level = useStoreValue(voiceLevel);
	const strength = Math.sqrt(level);
	return (
		<span
			aria-hidden="true"
			className="flex h-7 w-5 items-center justify-center gap-0.5 text-muted-foreground"
		>
			{[7, 20, 9].map((range, index) => (
				<span
					key={range}
					className="w-1 shrink-0 rounded-[2px] bg-current transition-[height] duration-200 ease-out motion-reduce:transition-none"
					style={{ height: (index === 1 ? 6 : 4) + strength * range }}
				/>
			))}
		</span>
	);
}
