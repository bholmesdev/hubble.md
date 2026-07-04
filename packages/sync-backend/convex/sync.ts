import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import {
	assetCleanupDeviceId,
	orphanAssetCandidates,
	referencedAssetPaths,
} from "./orphanAssets";

async function contentHash(content: string): Promise<string> {
	const data = new TextEncoder().encode(content);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(hash);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const tokenArg = v.object({
	token: v.string(),
	ip: v.optional(v.string()),
	userAgent: v.optional(v.string()),
});
const scopeArg = v.union(
	v.literal("read"),
	v.literal("write"),
	v.literal("admin"),
);

type AuthScope = "read" | "write" | "admin";
type AuthCtx = QueryCtx | MutationCtx;

async function sha256(value: string): Promise<string> {
	return contentHash(value);
}

function canUseScope(actual: AuthScope, required: AuthScope): boolean {
	if (actual === "admin") return true;
	if (actual === "write") return required !== "admin";
	return required === "read";
}

async function hasDevices(ctx: AuthCtx): Promise<boolean> {
	const first = await ctx.db.query("devices").first();
	return first !== null;
}

async function requireDevice(
	ctx: AuthCtx,
	auth: { token: string },
	requiredScope: AuthScope,
	workspaceId?: Id<"workspaces">,
): Promise<Doc<"devices">> {
	const tokenHash = await sha256(auth.token);
	const device = await ctx.db
		.query("devices")
		.withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
		.unique();
	const now = Date.now();
	if (!device || device.revokedAt !== undefined || device.expiresAt <= now) {
		throw new Error("Invalid or expired device token");
	}
	if (!canUseScope(device.scope, requiredScope)) {
		throw new Error("Device token scope denied");
	}
	if (
		workspaceId !== undefined &&
		device.workspaceIds.length > 0 &&
		!device.workspaceIds.includes(workspaceId)
	) {
		throw new Error("Device token workspace denied");
	}
	return device;
}

export const mintDevice = mutation({
	args: {
		auth: v.optional(tokenArg),
		label: v.string(),
		scope: scopeArg,
		workspaceIds: v.optional(v.array(v.id("workspaces"))),
		expiresAt: v.optional(v.number()),
		token: v.string(),
	},
	handler: async (
		ctx,
		{ auth, label, scope, workspaceIds, expiresAt, token },
	) => {
		if (await hasDevices(ctx)) {
			if (!auth) throw new Error("Admin token required");
			await requireDevice(ctx, auth, "admin");
		}
		const now = Date.now();
		const tokenHash = await sha256(token);
		const existing = await ctx.db
			.query("devices")
			.withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
			.unique();
		if (existing) throw new Error("Device token already exists");
		return ctx.db.insert("devices", {
			label,
			tokenHash,
			scope,
			workspaceIds: workspaceIds ?? [],
			createdAt: now,
			expiresAt: expiresAt ?? now + 365 * 24 * 60 * 60 * 1000,
		});
	},
});

export const listDevices = query({
	args: { auth: tokenArg },
	handler: async (ctx, { auth }) => {
		await requireDevice(ctx, auth, "admin");
		return ctx.db.query("devices").collect();
	},
});

export const revokeDevice = mutation({
	args: { auth: tokenArg, id: v.id("devices") },
	handler: async (ctx, { auth, id }) => {
		await requireDevice(ctx, auth, "admin");
		await ctx.db.patch(id, { revokedAt: Date.now() });
	},
});

async function upsertFile(
	ctx: MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		path: string;
		contentHash: string;
		content: string;
		deviceId: string;
	},
) {
	const { workspaceId, path, contentHash, content, deviceId } = args;
	const existing = await ctx.db
		.query("files")
		.withIndex("by_workspace_path", (q) =>
			q.eq("workspaceId", workspaceId).eq("path", path),
		)
		.unique();

	const now = Date.now();
	if (existing) {
		await ctx.db.patch(existing._id, {
			contentHash,
			content,
			updatedAt: now,
			deviceId,
			deleted: false,
		});
		return existing._id;
	}
	return ctx.db.insert("files", {
		workspaceId,
		path,
		contentHash,
		content,
		updatedAt: now,
		deviceId,
		deleted: false,
	});
}

export const getWorkspace = query({
	args: { auth: tokenArg, name: v.string() },
	handler: async (ctx, { auth, name }) => {
		await requireDevice(ctx, auth, "read");
		return ctx.db
			.query("workspaces")
			.withIndex("by_name", (q) => q.eq("name", name))
			.unique();
	},
});

export const createWorkspace = mutation({
	args: { auth: tokenArg, name: v.string() },
	handler: async (ctx, { auth, name }) => {
		await requireDevice(ctx, auth, "admin");
		const existing = await ctx.db
			.query("workspaces")
			.withIndex("by_name", (q) => q.eq("name", name))
			.unique();
		if (existing) throw new Error(`Workspace "${name}" already exists`);
		return ctx.db.insert("workspaces", { name, createdAt: Date.now() });
	},
});

export const listWorkspaces = query({
	args: { auth: tokenArg },
	handler: async (ctx, { auth }) => {
		await requireDevice(ctx, auth, "read");
		return ctx.db.query("workspaces").collect();
	},
});

export const getFilesByWorkspace = query({
	args: {
		workspaceId: v.id("workspaces"),
		auth: tokenArg,
		since: v.optional(v.number()),
		includeDeleted: v.optional(v.boolean()),
	},
	handler: async (ctx, { auth, workspaceId, since, includeDeleted }) => {
		await requireDevice(ctx, auth, "read", workspaceId);
		const q = ctx.db.query("files").withIndex("by_workspace", (q) => {
			const base = q.eq("workspaceId", workspaceId);
			return since !== undefined ? base.gt("updatedAt", since) : base;
		});
		const files = await q.collect();
		return includeDeleted ? files : files.filter((file) => !file.deleted);
	},
});

export const pushFile = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		auth: tokenArg,
		path: v.string(),
		contentHash: v.string(),
		content: v.string(),
		deviceId: v.string(),
	},
	handler: async (
		ctx,
		{ auth, workspaceId, path, contentHash, content, deviceId },
	) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		return upsertFile(ctx, {
			workspaceId,
			path,
			contentHash,
			content,
			deviceId,
		});
	},
});

export const softDeleteFile = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		auth: tokenArg,
		path: v.string(),
		deviceId: v.string(),
	},
	handler: async (ctx, { auth, workspaceId, path, deviceId }) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		const existing = await ctx.db
			.query("files")
			.withIndex("by_workspace_path", (q) =>
				q.eq("workspaceId", workspaceId).eq("path", path),
			)
			.unique();
		if (!existing) return;
		await ctx.db.patch(existing._id, {
			deleted: true,
			updatedAt: Date.now(),
			deviceId,
		});
	},
});

// --- Asset sync ---

async function upsertAsset(
	ctx: MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		path: string;
		storageId: Id<"_storage">;
		contentHash: string;
		deviceId: string;
	},
) {
	const { workspaceId, path, storageId, contentHash, deviceId } = args;
	const existing = await ctx.db
		.query("assets")
		.withIndex("by_workspace_path", (q) =>
			q.eq("workspaceId", workspaceId).eq("path", path),
		)
		.unique();

	const now = Date.now();
	if (existing) {
		if (existing.storageId !== storageId) {
			await ctx.storage.delete(existing.storageId);
		}
		await ctx.db.patch(existing._id, {
			storageId,
			contentHash,
			updatedAt: now,
			orphanedAt: undefined,
			deviceId,
			deleted: false,
		});
		return existing._id;
	}
	return ctx.db.insert("assets", {
		workspaceId,
		path,
		storageId,
		contentHash,
		updatedAt: now,
		deviceId,
		deleted: false,
	});
}

export const generateAssetUploadUrl = mutation({
	args: { auth: tokenArg, workspaceId: v.id("workspaces") },
	handler: async (ctx, { auth, workspaceId }) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		return ctx.storage.generateUploadUrl();
	},
});

export const pushAsset = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		auth: tokenArg,
		path: v.string(),
		storageId: v.id("_storage"),
		contentHash: v.string(),
		deviceId: v.string(),
	},
	handler: async (
		ctx,
		{ auth, workspaceId, path, storageId, contentHash, deviceId },
	) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		return upsertAsset(ctx, {
			workspaceId,
			path,
			storageId,
			contentHash,
			deviceId,
		});
	},
});

export const getAssetsByWorkspace = query({
	args: {
		workspaceId: v.id("workspaces"),
		auth: tokenArg,
		since: v.optional(v.number()),
	},
	handler: async (ctx, { auth, workspaceId, since }) => {
		await requireDevice(ctx, auth, "read", workspaceId);
		const q = ctx.db.query("assets").withIndex("by_workspace", (q) => {
			const base = q.eq("workspaceId", workspaceId);
			return since !== undefined ? base.gt("updatedAt", since) : base;
		});
		return q.collect();
	},
});

export const getAssetDownloadUrl = query({
	args: {
		auth: tokenArg,
		workspaceId: v.id("workspaces"),
		storageId: v.id("_storage"),
	},
	handler: async (ctx, { auth, workspaceId, storageId }) => {
		await requireDevice(ctx, auth, "read", workspaceId);
		const asset = await ctx.db
			.query("assets")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.filter((q) => q.eq(q.field("storageId"), storageId))
			.first();
		if (!asset) return null;
		return ctx.storage.getUrl(storageId);
	},
});

export const softDeleteAsset = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		auth: tokenArg,
		path: v.string(),
		deviceId: v.string(),
	},
	handler: async (ctx, { auth, workspaceId, path, deviceId }) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		const existing = await ctx.db
			.query("assets")
			.withIndex("by_workspace_path", (q) =>
				q.eq("workspaceId", workspaceId).eq("path", path),
			)
			.unique();
		if (!existing) return;
		// Eagerly delete blob — unlike markdown files (content stored inline),
		// keeping orphaned blobs in storage has real cost with no restore path.
		await ctx.storage.delete(existing.storageId);
		await ctx.db.patch(existing._id, {
			deleted: true,
			updatedAt: Date.now(),
			deviceId,
		});
	},
});

export const listOrphanAssetCandidates = query({
	args: { auth: tokenArg, workspaceId: v.id("workspaces") },
	handler: async (ctx, { auth, workspaceId }) => {
		await requireDevice(ctx, auth, "read", workspaceId);
		// Full-workspace scan for admin inspection. Avoid calling from reactive UI
		// paths or save/sync flows; large workspaces should use an indexed design.
		const [files, assets] = await Promise.all([
			ctx.db
				.query("files")
				.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
				.collect(),
			ctx.db
				.query("assets")
				.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
				.collect(),
		]);

		return orphanAssetCandidates(files, assets);
	},
});

async function markOrphanAssetCandidatesForWorkspace(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
) {
	// First phase of delayed cleanup. This is deliberately conservative: it
	// records candidates but leaves blobs in place for a later sweep.
	const [files, assets] = await Promise.all([
		ctx.db
			.query("files")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.collect(),
		ctx.db
			.query("assets")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.collect(),
	]);
	const references = referencedAssetPaths(files);
	const now = Date.now();
	let marked = 0;
	let restored = 0;

	for (const asset of assets) {
		if (asset.deleted) continue;
		if (references.has(asset.path)) {
			if (asset.orphanedAt !== undefined) {
				await ctx.db.patch(asset._id, { orphanedAt: undefined });
				restored++;
			}
			continue;
		}
		if (asset.orphanedAt === undefined) {
			await ctx.db.patch(asset._id, { orphanedAt: now });
			marked++;
		}
	}

	return { marked, restored };
}

export const markOrphanAssetCandidates = mutation({
	args: { auth: tokenArg, workspaceId: v.id("workspaces") },
	handler: async (ctx, { auth, workspaceId }) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		return markOrphanAssetCandidatesForWorkspace(ctx, workspaceId);
	},
});

async function deleteOrphanAssetsForWorkspace(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	gracePeriodMs: number,
) {
	// Second phase of delayed cleanup. Re-scan before deleting so assets that
	// became referenced during the grace period are restored instead of swept.
	const [files, assets] = await Promise.all([
		ctx.db
			.query("files")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.collect(),
		ctx.db
			.query("assets")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.collect(),
	]);
	const references = referencedAssetPaths(files);
	const cutoff = Date.now() - gracePeriodMs;
	const deleted: string[] = [];

	for (const asset of assets) {
		if (references.has(asset.path)) {
			if (asset.orphanedAt !== undefined) {
				await ctx.db.patch(asset._id, { orphanedAt: undefined });
			}
			continue;
		}
		if (
			asset.deleted ||
			asset.orphanedAt === undefined ||
			asset.orphanedAt > cutoff
		) {
			continue;
		}
		await ctx.storage.delete(asset.storageId);
		await ctx.db.patch(asset._id, {
			deleted: true,
			updatedAt: Date.now(),
			deviceId: assetCleanupDeviceId(),
		});
		deleted.push(asset.path);
	}

	return { deleted };
}

export const deleteOrphanAssets = mutation({
	args: {
		auth: tokenArg,
		workspaceId: v.id("workspaces"),
		gracePeriodMs: v.number(),
	},
	handler: async (ctx, { auth, workspaceId, gracePeriodMs }) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		return deleteOrphanAssetsForWorkspace(ctx, workspaceId, gracePeriodMs);
	},
});

export const runOrphanAssetCleanupForAllWorkspaces = internalMutation({
	args: { gracePeriodMs: v.number() },
	handler: async (ctx, { gracePeriodMs }) => {
		// Scheduled maintenance MVP: scan each workspace in one transaction. This is
		// acceptable while workspaces hold thousands of documents, not millions.
		const workspaces = await ctx.db.query("workspaces").collect();
		let marked = 0;
		let restored = 0;
		let deleted = 0;

		for (const workspace of workspaces) {
			const markResult = await markOrphanAssetCandidatesForWorkspace(
				ctx,
				workspace._id,
			);
			const deleteResult = await deleteOrphanAssetsForWorkspace(
				ctx,
				workspace._id,
				gracePeriodMs,
			);
			marked += markResult.marked;
			restored += markResult.restored;
			deleted += deleteResult.deleted.length;
		}

		return { workspaces: workspaces.length, marked, restored, deleted };
	},
});

export const debugRemoteEdit = mutation({
	args: {
		auth: tokenArg,
		workspaceId: v.id("workspaces"),
		path: v.string(),
		content: v.string(),
		deviceId: v.optional(v.string()),
	},
	handler: async (ctx, { auth, workspaceId, path, content, deviceId }) => {
		await requireDevice(ctx, auth, "write", workspaceId);
		return upsertFile(ctx, {
			workspaceId,
			path,
			content,
			contentHash: await contentHash(content),
			deviceId: deviceId ?? "debug-remote-edit",
		});
	},
});
