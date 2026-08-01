import type { WorkspaceDelta } from "../desktopApi/types";
import { pathEquals, pathInFolder } from "../lib/filePath";
import type { FileEntry, FolderEntry } from "./state";

type SidebarSnapshot = {
	files: FileEntry[];
	folders: FolderEntry[];
};

function isSameOrInside(candidate: string, parent: string): boolean {
	return pathEquals(candidate, parent) || pathInFolder(candidate, parent);
}

function withoutPrefix<T extends { path: string }>(
	entries: T[],
	prefix: string,
): T[] {
	return entries.filter((entry) => !isSameOrInside(entry.path, prefix));
}

function upsert<T extends { path: string }>(entries: T[], next: T): T[] {
	const index = entries.findIndex((entry) => pathEquals(entry.path, next.path));
	if (index < 0) return [...entries, next];
	return entries.map((entry, entryIndex) =>
		entryIndex === index ? next : entry,
	);
}

export function applyWorkspaceDelta(
	snapshot: SidebarSnapshot,
	delta: WorkspaceDelta,
): SidebarSnapshot {
	switch (delta.kind) {
		case "file":
			return {
				files: upsert(snapshot.files, delta.entry),
				folders: withoutPrefix(snapshot.folders, delta.entry.path),
			};
		case "folder":
			return {
				files: withoutPrefix(snapshot.files, delta.entry.path),
				folders: upsert(snapshot.folders, delta.entry),
			};
		case "subtree":
			return {
				files: [
					...withoutPrefix(snapshot.files, delta.path),
					...delta.listing.files,
				],
				folders: [
					...withoutPrefix(snapshot.folders, delta.path),
					...delta.listing.folders,
				],
			};
		case "remove":
			return {
				files: withoutPrefix(snapshot.files, delta.path),
				folders: withoutPrefix(snapshot.folders, delta.path),
			};
		case "refresh":
			return snapshot;
	}
}
