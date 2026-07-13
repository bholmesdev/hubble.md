type SaveMarkdown = (path: string, markdown: string) => void | Promise<void>;

export type PendingSave = {
	markdown: string;
	path: string;
	save: SaveMarkdown;
	timer: number;
};

type PendingSaveRef = { current: PendingSave | null };

/** Cancels the timer first so cleanup and the debounce cannot save the same edit twice. */
export function flushPendingSave(ref: PendingSaveRef) {
	const pending = ref.current;
	if (!pending) return;
	window.clearTimeout(pending.timer);
	ref.current = null;
	void pending.save(pending.path, pending.markdown);
}

export function schedulePendingSave({
	delay,
	markdown,
	path,
	ref,
	save,
}: {
	delay: number;
	markdown: string;
	path: string;
	ref: PendingSaveRef;
	save: SaveMarkdown;
}) {
	const existing = ref.current;
	if (existing) {
		if (existing.path !== path) {
			flushPendingSave(ref);
		} else {
			window.clearTimeout(existing.timer);
			ref.current = null;
		}
	}

	const pending: PendingSave = { markdown, path, save, timer: 0 };
	pending.timer = window.setTimeout(() => {
		if (ref.current !== pending) return;
		ref.current = null;
		void pending.save(pending.path, pending.markdown);
	}, delay);
	ref.current = pending;
}
