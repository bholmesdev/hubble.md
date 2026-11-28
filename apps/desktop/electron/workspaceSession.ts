import {
	type WatchFactory,
	type WatchHandle,
	watchWorkspace,
} from "./workspaceWatcher";

type WorkspaceChange = { kind: "paths"; paths: string[] } | { kind: "refresh" };

/** Tracks the selected workspace even if native file watching is unavailable. */
export class WorkspaceSession {
	private current: {
		root: string;
		generation: number;
		watcher: WatchHandle | null;
	} | null = null;
	private generation = 0;
	constructor(
		private onChange: (change: WorkspaceChange) => void,
		private watch?: WatchFactory,
	) {}
	get root() {
		return this.current?.root;
	}
	start(root: string) {
		// Strict Mode can start twice before the older effect cleans up. Each start needs its own ID.
		this.clear();
		const generation = this.generation;
		const watcher = watchWorkspace(
			root,
			(paths) => {
				if (this.current?.generation === generation)
					this.onChange({ kind: "paths", paths });
			},
			(reason) => {
				if (this.current?.generation !== generation) return;
				if (reason === "watch-error") this.current.watcher = null;
				this.onChange({ kind: "refresh" });
			},
			this.watch,
		);
		this.current = { root, generation, watcher };
		return generation;
	}
	stop(generation: number) {
		if (this.current?.generation === generation) this.clear();
	}
	private clear() {
		this.generation++;
		this.current?.watcher?.close();
		this.current = null;
	}
}
