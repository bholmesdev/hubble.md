import type { SyncBackend } from "@hubble.md/sync";
import { api } from "@hubble.md/sync-backend";
import type { Id } from "@hubble.md/sync-backend/types";
import { ConvexClient, ConvexHttpClient } from "convex/browser";

export type Subscriber = {
	onFilesChanged(
		workspaceId: string,
		callback: () => void,
		onError: (err: Error) => void,
	): () => void;
	onAssetsChanged(
		workspaceId: string,
		callback: () => void,
		onError: (err: Error) => void,
	): () => void;
	close(): Promise<void>;
};

type AuthArgs = { token: string };

export function createConvexBackend(url: string, token: string): SyncBackend {
	const client = new ConvexHttpClient(url);
	const auth: AuthArgs = { token };
	return {
		async getWorkspace(name) {
			const workspace = await client.query(api.sync.getWorkspace, {
				auth,
				name,
			});
			return workspace?._id ?? null;
		},
		async createWorkspace(name) {
			return client.mutation(api.sync.createWorkspace, { auth, name });
		},
		async getFiles(workspaceId, opts) {
			const files = await client.query(api.sync.getFilesByWorkspace, {
				auth,
				workspaceId: workspaceId as Id<"workspaces">,
				since: opts?.since,
				includeDeleted: opts?.includeDeleted,
			});
			return opts?.includeDeleted
				? files
				: files.filter((file) => !file.deleted);
		},
		async pushFile(args) {
			await client.mutation(api.sync.pushFile, {
				...args,
				auth,
				workspaceId: args.workspaceId as Id<"workspaces">,
			});
		},
		async softDeleteFile(args) {
			await client.mutation(api.sync.softDeleteFile, {
				...args,
				auth,
				workspaceId: args.workspaceId as Id<"workspaces">,
			});
		},
		async getAssets(workspaceId, since) {
			return client.query(api.sync.getAssetsByWorkspace, {
				auth,
				workspaceId: workspaceId as Id<"workspaces">,
				since,
			});
		},
		async pushAsset(args) {
			await client.mutation(api.sync.pushAsset, {
				...args,
				auth,
				workspaceId: args.workspaceId as Id<"workspaces">,
				storageId: args.storageId as Id<"_storage">,
			});
		},
		async softDeleteAsset(args) {
			await client.mutation(api.sync.softDeleteAsset, {
				...args,
				auth,
				workspaceId: args.workspaceId as Id<"workspaces">,
			});
		},
		async generateAssetUploadUrl(workspaceId) {
			return client.mutation(api.sync.generateAssetUploadUrl, {
				auth,
				workspaceId: workspaceId as Id<"workspaces">,
			});
		},
		async getAssetDownloadUrl(workspaceId, storageId) {
			return client.query(api.sync.getAssetDownloadUrl, {
				auth,
				workspaceId: workspaceId as Id<"workspaces">,
				storageId: storageId as Id<"_storage">,
			});
		},
	};
}

export function createConvexSubscriber(url: string, token: string): Subscriber {
	const client = new ConvexClient(url);
	const auth: AuthArgs = { token };
	return {
		onFilesChanged(workspaceId, callback, onError) {
			// Convex's onUpdate fires immediately with current state, then on
			// every change. We invoke `callback` for every fire — including the
			// initial — so the consumer can use it as the canonical source of
			// file-list state without an extra fetch and without a race window
			// where changes during subscription setup get dropped.
			return client.onUpdate(
				api.sync.getFilesByWorkspace,
				{ auth, workspaceId: workspaceId as Id<"workspaces"> },
				() => callback(),
				onError,
			);
		},
		onAssetsChanged(workspaceId, callback, onError) {
			return client.onUpdate(
				api.sync.getAssetsByWorkspace,
				{ auth, workspaceId: workspaceId as Id<"workspaces"> },
				() => callback(),
				onError,
			);
		},
		async close() {
			await client.close();
		},
	};
}
