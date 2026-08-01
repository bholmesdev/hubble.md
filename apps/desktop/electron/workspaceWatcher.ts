import fs from "node:fs";
import path from "node:path";

export type WorkspaceWatchFilename = string | Buffer | null;
export type WorkspaceWatchListener = (
	eventType: string,
	filename: WorkspaceWatchFilename,
) => void;

export type WorkspaceWatchHandle = {
	close: () => void;
};

export type WorkspaceWatchFactory = (
	root: string,
	listener: WorkspaceWatchListener,
) => fs.FSWatcher;

const DEFAULT_COALESCE_MS = 75;

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

export function normalizeWorkspaceEventPath(
	root: string,
	filename: WorkspaceWatchFilename,
): string | null {
	if (filename === null) return null;
	const value = Buffer.isBuffer(filename) ? filename.toString() : filename;
	if (value.length === 0) return null;
	const resolved = path.resolve(root, value);
	return isWithin(root, resolved) ? resolved : null;
}

export function createWorkspacePathCoalescer(
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

const nativeWatch: WorkspaceWatchFactory = (root, listener) =>
	fs.watch(root, { recursive: true }, listener);

export function startNativeWorkspaceWatcher(
	root: string,
	onPaths: (paths: string[]) => void,
	onFallback: () => void,
	watch: WorkspaceWatchFactory = nativeWatch,
): WorkspaceWatchHandle | null {
	let closed = false;
	const coalescer = createWorkspacePathCoalescer(onPaths);
	let watcher: fs.FSWatcher;
	try {
		watcher = watch(root, (eventType, filename) => {
			if (closed) return;
			// Content changes belong to the active-file watcher; sidebar state only
			// needs the add/delete/rename hints reported as rename events.
			if (eventType !== "rename") return;
			const changedPath = normalizeWorkspaceEventPath(root, filename);
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
