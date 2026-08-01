import { describe, expect, it } from "vitest";
import type { DirectoryListing } from "../desktopApi/types";
import { applyWorkspaceDelta } from "./workspaceDelta";

const snapshot: DirectoryListing = {
	files: [
		{ path: "/workspace/old.md", modified_at: 1, kind: "document" },
		{ path: "/workspace/archive/old.md", modified_at: 1, kind: "document" },
	],
	folders: [
		{ path: "/workspace/archive", modified_at: 1 },
		{ path: "/workspace/archive/nested", modified_at: 1 },
	],
};

describe("applyWorkspaceDelta", () => {
	it("adds and updates one file without touching content siblings", () => {
		const next = applyWorkspaceDelta(snapshot, {
			kind: "file",
			entry: {
				path: "/workspace/new.md",
				modified_at: 2,
				kind: "document",
			},
		});

		expect(next.files).toEqual([
			snapshot.files[0],
			snapshot.files[1],
			{ path: "/workspace/new.md", modified_at: 2, kind: "document" },
		]);
		expect(next.folders).toEqual(snapshot.folders);
	});

	it("removes a directory prefix", () => {
		expect(
			applyWorkspaceDelta(snapshot, {
				kind: "remove",
				path: "/workspace/archive",
			}),
		).toEqual({ files: [snapshot.files[0]], folders: [] });
	});

	it("replaces only an affected subtree", () => {
		expect(
			applyWorkspaceDelta(snapshot, {
				kind: "subtree",
				path: "/workspace/archive",
				listing: {
					files: [
						{
							path: "/workspace/archive/new.md",
							modified_at: 2,
							kind: "document",
						},
					],
					folders: [{ path: "/workspace/archive/fresh", modified_at: 2 }],
				},
			}),
		).toEqual({
			files: [
				snapshot.files[0],
				{
					path: "/workspace/archive/new.md",
					modified_at: 2,
					kind: "document",
				},
			],
			folders: [{ path: "/workspace/archive/fresh", modified_at: 2 }],
		});
	});
});
