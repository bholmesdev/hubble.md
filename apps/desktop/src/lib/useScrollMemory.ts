import { useEffect } from "react";
import { recallScroll, setScrollContainer } from "./scrollMemory";

/** Roughly a second at 60fps, after which the note is not going to grow. */
const RESTORE_FRAMES = 60;

/**
 * Puts a reopened note back where the user left it, and keeps the module's
 * reference to the live scroll container current.
 *
 * Restoring has to outlast the editor filling in: the container serves every
 * note and still holds the last one's content for a frame or two, so
 * `scrollTop` is set again each frame until it sticks.
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
