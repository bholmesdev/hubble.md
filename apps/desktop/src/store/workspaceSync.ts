import { refreshFilesSnapshot } from "./actions";

const QUIET_MS = 300;

export function createWorkspaceSync(scan: () => Promise<void>) {
	let dirty = false;
	let scanning = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;

	function schedule() {
		if (scanning) return;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(run, QUIET_MS);
	}

	async function run() {
		const runGeneration = generation;
		timer = null;
		if (!dirty) return;
		dirty = false;
		scanning = true;
		try {
			await scan();
		} finally {
			if (runGeneration !== generation) return;
			scanning = false;
			if (dirty) schedule();
		}
	}

	return {
		markDirty() {
			dirty = true;
			schedule();
		},
		reset() {
			generation += 1;
			if (timer !== null) clearTimeout(timer);
			timer = null;
			dirty = false;
			scanning = false;
		},
	};
}

export const workspaceSync = createWorkspaceSync(() => refreshFilesSnapshot());
