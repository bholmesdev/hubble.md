import { z } from "zod/v4";

export const WorkspaceConfigSchema = z.object({
	cloudSync: z
		.object({
			provider: z.literal("convex"),
			deploymentUrl: z.string(),
			workspaceId: z.string(),
			deviceId: z.string(),
			backgroundSync: z.boolean(),
		})
		.optional(),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type CloudSyncConfig = NonNullable<WorkspaceConfig["cloudSync"]>;

export const FileStateSchema = z.object({
	hash: z.string(),
	lastSyncedAt: z.number(),
});
export type FileState = z.infer<typeof FileStateSchema>;

export const SyncStateSchema = z.object({
	lastSyncedAt: z.number(),
	files: z.record(z.string(), FileStateSchema),
	assets: z.record(z.string(), FileStateSchema).optional(),
});
export type SyncState = z.infer<typeof SyncStateSchema>;

export type SyncResult = {
	pushed: string[];
	pulled: string[];
	deleted: string[];
	conflicts: string[];
	unchanged: number;
	assetsPushed: number;
	assetsPulled: number;
	assetsDeleted: number;
	assetsFailed: string[];
};

export type RemoteFile = {
	_id: string;
	path: string;
	contentHash: string;
	content: string;
	updatedAt: number;
	deviceId: string;
	deleted: boolean;
};

export type RemoteAsset = {
	_id: string;
	path: string;
	storageId: string;
	contentHash: string;
	updatedAt: number;
	deviceId: string;
	deleted: boolean;
};
