/**
 * Where the user was in each note, so reopening one lands where they left it.
 *
 * Keyed by path rather than by Tab on purpose: scroll outlives the Tab that
 * showed it, so closing and reopening a note keeps the position, and a note
 * open in one Tab keeps it when another Tab is the one that closes.
 *
 * The position is read as navigation leaves a note, not from a scroll
 * listener. One scroll container serves every note, and swapping its content
 * drops `scrollTop` to zero — a listener hears that as the user scrolling to
 * the top.
 */

/** Enough for a working set of notes; older entries are the ones worth losing. */
const MAX_REMEMBERED = 50;

const positions = new Map<string, number>();

let container: HTMLElement | null = null;

/** The live editor viewport, registered by the view that owns it. */
export function setScrollContainer(element: HTMLElement | null) {
	container = element;
}

export function rememberScroll(path: string, top: number) {
	if (!path) return;
	// Re-inserting moves the entry to the end, which makes the first key the
	// least recently touched one to drop.
	positions.delete(path);
	positions.set(path, top);
	if (positions.size > MAX_REMEMBERED) {
		const oldest = positions.keys().next().value;
		if (oldest !== undefined) positions.delete(oldest);
	}
}

/** Records where `path` is sitting right now, before navigation moves off it. */
export function captureScroll(path: string | null) {
	if (!path || !container) return;
	rememberScroll(path, container.scrollTop);
}

export function recallScroll(path: string) {
	return positions.get(path);
}

/**
 * Moves remembered positions with the files they belong to. Takes the same
 * rewrite its caller hands `rewriteHistory`, so a rename, a folder rename, a
 * move, and an auto-title all keep their positions by the rule they already
 * use rather than by one this module guesses at.
 */
export function rewriteScrollMemory(rewrite: (path: string) => string) {
	const moved = [...positions].map(
		([path, top]) => [rewrite(path), top] as const,
	);
	positions.clear();
	for (const [path, top] of moved) positions.set(path, top);
}

/** Called when the open folder changes, since those paths are gone from view. */
export function forgetScrollPositions() {
	positions.clear();
}
