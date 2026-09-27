import { useEffect } from "react";
import { recallScroll, setScrollContainer } from "./scrollMemory";

// Bound retries while the editor lays out the reopened note.
const RESTORE_FRAMES = 60;

/**
 * Retry until the editor is tall enough to restore the saved position.
 * The shared container can still hold the previous note during the first frame.
 */
export function useScrollMemory(
	path: string | null,
	container: HTMLElement | null,
) {
	useEffect(() => {
		setScrollContainer(container);
		if (!path || !container) return;

		const target = recallScroll(path);
		if (target === undefined || target <= 0) return;

		let attempts = 0;
		let frame = 0;
		const apply = () => {
			container.scrollTop = target;
			attempts += 1;
			if (container.scrollTop < target && attempts < RESTORE_FRAMES) {
				frame = requestAnimationFrame(apply);
			}
		};
		frame = requestAnimationFrame(apply);

		return () => cancelAnimationFrame(frame);
	}, [path, container]);
}
