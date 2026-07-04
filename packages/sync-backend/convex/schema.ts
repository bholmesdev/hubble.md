import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	devices: defineTable({
		label: v.string(),
		tokenHash: v.string(),
		scope: v.union(v.literal("read"), v.literal("write"), v.literal("admin")),
		workspaceIds: v.array(v.id("workspaces")),
		createdAt: v.number(),
		expiresAt: v.number(),
		revokedAt: v.optional(v.number()),
		lastUsedAt: v.optional(v.number()),
		lastUsedIp: v.optional(v.string()),
		lastUsedUserAgent: v.optional(v.string()),
	}).index("by_tokenHash", ["tokenHash"]),

	workspaces: defineTable({
		name: v.string(),
		createdAt: v.number(),
	}).index("by_name", ["name"]),

	files: defineTable({
		workspaceId: v.id("workspaces"),
		path: v.string(),
		contentHash: v.string(),
		content: v.string(),
		updatedAt: v.number(),
		deviceId: v.string(),
		deleted: v.boolean(),
	})
		.index("by_workspace", ["workspaceId", "updatedAt"])
		.index("by_workspace_path", ["workspaceId", "path"]),

	assets: defineTable({
		workspaceId: v.id("workspaces"),
		path: v.string(),
		storageId: v.id("_storage"),
		contentHash: v.string(),
		updatedAt: v.number(),
		orphanedAt: v.optional(v.number()),
		deviceId: v.string(),
		deleted: v.boolean(),
	})
		.index("by_workspace", ["workspaceId", "updatedAt"])
		.index("by_workspace_path", ["workspaceId", "path"]),
});
