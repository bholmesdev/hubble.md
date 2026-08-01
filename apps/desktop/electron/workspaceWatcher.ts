import fs from "node:fs";
import path from "node:path";

export type WatchFilename = string | Buffer | null;
export type WatchListener = (
	eventType: string,
	filename: WatchFilename,
) => void;

export type WatchHandle = {
	close: () => void;
};

export type WatchFactory = (
	root: string,
	listener: WatchListener,
) => fs.FSWatcher;

const DEFAULT_COALESCE_MS = 75;

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

export function normalizeEventPath(
	root: string,
	filename: WatchFilename,
): string | null {
	if (filename === null) return null;
	const value = Buffer.isBuffer(filename) ? filename.toString() : filename;
	if (value.length === 0) return null;
	const resolved = path.resolve(root, value);
	return isWithin(root, resolved) ? resolved : null;
}

export function createPathCoalescer(
	onPaths: (paths: string[]) => void,
	delayMs = DEFAULT_COALESCE_MS,
) {
	const paths = new Set<string>();
	let timer: NodeJS.Timeout | null = null;

	function flush() {
		timer = null;
		if (paths.size === 0) return;
		const nextPaths = [...paths];
		paths.clear();
		onPaths(nextPaths);
	}

	return {
		add(changedPath: string) {
			paths.add(changedPath);
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(flush, delayMs);
		},
		close() {
			if (timer !== null) clearTimeout(timer);
			timer = null;
			paths.clear();
		},
	};
}

const nativeWatch: WatchFactory = (root, listener) =>
	fs.watch(root, { recursive: true }, listener);

export function watchWorkspace(
	root: string,
	onPaths: (paths: string[]) => void,
	onFallback: () => void,
	watch: WatchFactory = nativeWatch,
): WatchHandle | null {
	let closed = false;
	const coalescer = createPathCoalescer(onPaths);
	let watcher: fs.FSWatcher;
	try {
		watcher = watch(root, (eventType, filename) => {
			if (closed) return;
			// Content changes belong to the active-file watcher; sidebar state only
			// needs the add/delete/rename hints reported as rename events.
			if (eventType !== "rename") return;
			const changedPath = normalizeEventPath(root, filename);
			if (changedPath === null) {
				onFallback();
				return;
			}
			coalescer.add(changedPath);
		});
	} catch {
		coalescer.close();
		return null;
	}

	const fail = () => {
		if (closed) return;
		closed = true;
		coalescer.close();
		watcher.close();
		onFallback();
	};
	watcher.on("error", fail);

	return {
		close() {
			if (closed) return;
			closed = true;
			coalescer.close();
			watcher.close();
		},
	};
}
