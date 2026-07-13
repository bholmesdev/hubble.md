import type { SyncBackend } from "./backend.js";
import {
	isInitialized,
	readConfig,
	readConfigOrDefault,
	readSyncState,
	writeCloudSyncConfig,
	writeSyncState,
} from "./config.js";
import type { FileSystem, InitFileSystem } from "./fs.js";
import type {
	CloudSyncConfig,
	FileState,
	RemoteAsset,
	SyncResult,
	WorkspaceConfig,
} from "./types.js";

/** Initialize a workspace for syncing. Creates .hubble/ config. */
export async function init(
	backend: SyncBackend,
	fs: InitFileSystem,
	opts: {
		workspacePath: string;
		workspaceName: string;
		deploymentUrl: string;
		backgroundSync?: boolean;
	},
): Promise<WorkspaceConfig> {
	const existing = await readConfigOrDefault(fs, opts.workspacePath);
	if (existing.cloudSync) return existing;

	const workspaceId =
		(await backend.getWorkspace(opts.workspaceName)) ??
		(await backend.createWorkspace(opts.workspaceName));

	const cloudSync: CloudSyncConfig = {
		provider: "convex",
		deploymentUrl: opts.deploymentUrl,
		workspaceId,
		deviceId: crypto.randomUUID(),
		backgroundSync: opts.backgroundSync ?? false,
	};
	await writeSyncState(fs, opts.workspacePath, { lastSyncedAt: 0, files: {} });
	return writeCloudSyncConfig(fs, opts.workspacePath, cloudSync);
}

/** Run a full sync: push local changes, pull remote changes, detect conflicts. */
export async function sync(
	backend: SyncBackend,
	fs: FileSystem,
	workspacePath: string,
): Promise<SyncResult> {
	const config = await readConfig(fs, workspacePath);
	if (!config.cloudSync) {
		throw new Error(
			`No Cloud Sync config in ${workspacePath}. Run \`hubble cloud connect\` first.`,
		);
	}
	const state = await readSyncState(fs, workspacePath);
	const { workspaceId, deviceId } = config.cloudSync;

	const localFiles = await fs.listMarkdownFiles(workspacePath);
	const localByPath = new Map(localFiles.map((f) => [f.relativePath, f]));

	const remoteFiles = await backend.getFiles(workspaceId, {
		includeDeleted: true,
	});
	const remoteByPath = new Map(remoteFiles.map((f) => [f.path, f]));

	const result: SyncResult = {
		pushed: [],
		pulled: [],
		deleted: [],
		conflicts: [],
		unchanged: 0,
		assetsPushed: 0,
		assetsPulled: 0,
		assetsDeleted: 0,
		assetsFailed: [],
	};
	const nextFiles: Record<string, FileState> = { ...state.files };
	const now = Date.now();

	async function pushLocal(path: string, hash: string, content: string) {
		await backend.pushFile({
			workspaceId,
			path,
			contentHash: hash,
			content,
			deviceId,
		});
		nextFiles[path] = { hash, lastSyncedAt: now };
		result.pushed.push(path);
	}

	async function ensureParentDir(path: string) {
		const slash = path.lastIndexOf("/");
		if (slash > 0)
			await fs.ensureDir(`${workspacePath}/${path.slice(0, slash)}`);
	}

	// --- Process files that exist locally ---
	for (const local of localFiles) {
		const prev = state.files[local.relativePath];
		const remote = remoteByPath.get(local.relativePath);
		const localChanged = !prev || prev.hash !== local.hash;

		// Remote was soft-deleted
		if (remote?.deleted) {
			// Only re-push if genuinely modified since last sync.
			// When prev is missing (untracked), honor the tombstone.
			if (prev && prev.hash !== local.hash) {
				await pushLocal(local.relativePath, local.hash, local.content);
			} else {
				await fs.deleteFile(`${workspacePath}/${local.relativePath}`);
				delete nextFiles[local.relativePath];
				result.deleted.push(local.relativePath);
			}
			continue;
		}

		if (!remote) {
			await pushLocal(local.relativePath, local.hash, local.content);
			continue;
		}

		const remoteChanged = !prev || prev.hash !== remote.contentHash;
		const diverged = remoteChanged && remote.contentHash !== local.hash;

		if (diverged && localChanged) {
			const conflictName = toConflictName(local.relativePath);
			await fs.writeFile(`${workspacePath}/${conflictName}`, local.content);
			await fs.writeFile(
				`${workspacePath}/${local.relativePath}`,
				remote.content,
			);
			nextFiles[local.relativePath] = {
				hash: remote.contentHash,
				lastSyncedAt: now,
			};
			result.conflicts.push(local.relativePath);
		} else if (diverged) {
			await fs.writeFile(
				`${workspacePath}/${local.relativePath}`,
				remote.content,
			);
			nextFiles[local.relativePath] = {
				hash: remote.contentHash,
				lastSyncedAt: now,
			};
			result.pulled.push(local.relativePath);
		} else if (localChanged) {
			await pushLocal(local.relativePath, local.hash, local.content);
		} else {
			result.unchanged++;
		}
	}

	// --- Detect local deletions (in state but no longer on disk) ---
	for (const [path, prev] of Object.entries(state.files)) {
		if (localByPath.has(path)) continue; // still on disk, handled above

		const remote = remoteByPath.get(path);
		if (remote && !remote.deleted && remote.contentHash !== prev.hash) {
			// Remote edited since last sync — pull back to preserve others' edits
			await ensureParentDir(path);
			await fs.writeFile(`${workspacePath}/${path}`, remote.content);
			nextFiles[path] = { hash: remote.contentHash, lastSyncedAt: now };
			result.pulled.push(path);
		} else if (remote && !remote.deleted) {
			// Remote unchanged — push tombstone
			await backend.softDeleteFile({
				workspaceId,
				path,
				deviceId,
			});
			delete nextFiles[path];
			result.deleted.push(path);
		} else {
			// Remote already deleted or doesn't exist — clean state
			delete nextFiles[path];
		}
	}

	// --- Pull new remote files not present locally ---
	for (const remote of remoteFiles) {
		if (remote.deleted) continue;
		if (localByPath.has(remote.path)) continue;
		if (state.files[remote.path]) continue; // local delete, handled above

		await ensureParentDir(remote.path);
		await fs.writeFile(`${workspacePath}/${remote.path}`, remote.content);
		nextFiles[remote.path] = { hash: remote.contentHash, lastSyncedAt: now };
		result.pulled.push(remote.path);
	}

	// --- Asset sync ---
	const prevAssets = state.assets ?? {};
	const nextAssets: Record<string, FileState> = { ...prevAssets };

	const localAssets = await fs.listAssetFiles(workspacePath);
	const localAssetByPath = new Map(localAssets.map((a) => [a.relativePath, a]));

	const remoteAssets = await backend.getAssets(workspaceId);
	const remoteAssetByPath = new Map(remoteAssets.map((a) => [a.path, a]));

	async function pushAsset(path: string, hash: string) {
		const uploadUrl = await backend.generateAssetUploadUrl();
		const data = await fs.readBinaryFile(`${workspacePath}/${path}`);
		const res = await fetch(uploadUrl, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream" },
			body: data,
		});
		if (!res.ok) {
			throw new Error(`Asset upload failed for ${path}: ${res.status}`);
		}
		const { storageId } = (await res.json()) as { storageId: string };
		await backend.pushAsset({
			workspaceId,
			path,
			storageId,
			contentHash: hash,
			deviceId,
		});
		nextAssets[path] = { hash, lastSyncedAt: now };
		result.assetsPushed++;
	}

	async function pullAsset(remote: RemoteAsset) {
		const url = await backend.getAssetDownloadUrl(remote.storageId);
		if (!url) return;
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(
				`Asset download failed for ${remote.path}: ${res.status}`,
			);
		}
		const buf = new Uint8Array(await res.arrayBuffer());
		await ensureParentDir(remote.path);
		await fs.writeBinaryFile(`${workspacePath}/${remote.path}`, buf);
		nextAssets[remote.path] = {
			hash: remote.contentHash,
			lastSyncedAt: now,
		};
		result.assetsPulled++;
	}

	async function tryPushAsset(path: string, hash: string) {
		try {
			await pushAsset(path, hash);
		} catch {
			result.assetsFailed.push(path);
		}
	}

	async function tryPullAsset(remote: RemoteAsset) {
		try {
			await pullAsset(remote);
		} catch {
			result.assetsFailed.push(remote.path);
		}
	}

	// Process locally present assets
	for (const local of localAssets) {
		const prev = prevAssets[local.relativePath];
		const remote = remoteAssetByPath.get(local.relativePath);
		const localChanged = !prev || prev.hash !== local.hash;

		if (remote?.deleted) {
			if (prev && prev.hash !== local.hash) {
				await tryPushAsset(local.relativePath, local.hash);
			} else {
				await fs.deleteFile(`${workspacePath}/${local.relativePath}`);
				delete nextAssets[local.relativePath];
				result.assetsDeleted++;
			}
			continue;
		}

		if (!remote) {
			await tryPushAsset(local.relativePath, local.hash);
			continue;
		}

		const remoteChanged = !prev || prev.hash !== remote.contentHash;
		const diverged = remoteChanged && remote.contentHash !== local.hash;

		if (diverged) {
			// Last-write-wins for binary assets — pull remote
			await tryPullAsset(remote);
		} else if (localChanged) {
			await tryPushAsset(local.relativePath, local.hash);
		}
	}

	// Detect local asset deletions
	for (const path of Object.keys(prevAssets)) {
		if (localAssetByPath.has(path)) continue;
		const remote = remoteAssetByPath.get(path);
		if (remote && !remote.deleted) {
			await backend.softDeleteAsset({
				workspaceId,
				path,
				deviceId,
			});
			delete nextAssets[path];
			result.assetsDeleted++;
		} else {
			delete nextAssets[path];
		}
	}

	// Pull new remote assets not present locally
	for (const remote of remoteAssets) {
		if (remote.deleted) continue;
		if (localAssetByPath.has(remote.path)) continue;
		if (prevAssets[remote.path]) continue;
		await tryPullAsset(remote);
	}

	await writeSyncState(fs, workspacePath, {
		lastSyncedAt: now,
		files: nextFiles,
		assets: nextAssets,
	});
	return result;
}

/** Get current sync status without performing a sync. */
export async function status(fs: FileSystem, workspacePath: string) {
	if (!(await isInitialized(fs, workspacePath))) {
		return { initialized: false as const };
	}
	const config = await readConfig(fs, workspacePath);
	const state = await readSyncState(fs, workspacePath);
	const localFiles = await fs.listMarkdownFiles(workspacePath);

	let pendingChanges = 0;
	for (const f of localFiles) {
		const prev = state.files[f.relativePath];
		if (!prev || prev.hash !== f.hash) pendingChanges++;
	}

	return {
		initialized: true as const,
		cloudSync: config.cloudSync,
		lastSyncedAt: state.lastSyncedAt,
		localFiles: localFiles.length,
		trackedFiles: Object.keys(state.files).length,
		pendingChanges,
	};
}

function toConflictName(filePath: string): string {
	const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
	const dot = filePath.lastIndexOf(".");
	if (dot === -1) return `${filePath}.conflict-${ts}`;
	return `${filePath.slice(0, dot)}.conflict-${ts}${filePath.slice(dot)}`;
}
