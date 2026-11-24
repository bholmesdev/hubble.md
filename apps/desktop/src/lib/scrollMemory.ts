/**
 * Key positions by path so they survive closing and reopening a tab.
 * Capture before navigation: replacing editor content can reset scrollTop,
 * which a scroll listener would mistake for the user's position.
 * Notes remember a scroll offset; diagrams remember their camera.
 */
const MAX_REMEMBERED = 50;

export type Camera = { x: number; y: number; z: number };

const positions = new Map<string, number | Camera>();

let container: HTMLElement | null = null;

export function setScrollContainer(element: HTMLElement | null) {
	container = element;
}

function remember(path: string, position: number | Camera) {
	if (!path) return;
	// Reinsert so the oldest entry stays first for eviction.
	positions.delete(path);
	positions.set(path, position);
	if (positions.size > MAX_REMEMBERED) {
		const oldest = positions.keys().next().value;
		if (oldest !== undefined) positions.delete(oldest);
	}
}

export function rememberScroll(path: string, top: number) {
	remember(path, top);
}

/** Capture before navigation replaces the shared editor content. */
export function captureScroll(path: string | null) {
	if (!path || !container) return;
	rememberScroll(path, container.scrollTop);
}

export function recallScroll(path: string) {
	const position = positions.get(path);
	return typeof position === "number" ? position : undefined;
}

export function rememberCamera(path: string, { x, y, z }: Camera) {
	remember(path, { x, y, z });
}

export function recallCamera(path: string) {
	const position = positions.get(path);
	return typeof position === "object" ? position : undefined;
}

/** Share the file operation's path rewrite so scroll positions follow renames and moves. */
export function rewriteScrollMemory(rewrite: (path: string) => string) {
	const moved = [...positions].map(
		([path, top]) => [rewrite(path), top] as const,
	);
	positions.clear();
	for (const [path, top] of moved) positions.set(path, top);
}

export function forgetScrollPositions() {
	positions.clear();
}
