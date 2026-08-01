import type { WorkspaceDelta } from "../desktopApi/types";
import { pathEquals, pathInFolder } from "../lib/filePath";
import type { FileEntry, FolderEntry } from "./state";

type SidebarSnapshot = {
	files: FileEntry[];
	folders: FolderEntry[];
};

/** Drop entries at `parent` or anywhere under it. */
function prune<T extends { path: string }>(entries: T[], parent: string): T[] {
	return entries.filter(
		(entry) =>
			!pathEquals(entry.path, parent) && !pathInFolder(entry.path, parent),
	);
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
				folders: prune(snapshot.folders, delta.entry.path),
			};
		case "subtree":
			return {
				files: [...prune(snapshot.files, delta.path), ...delta.listing.files],
				folders: [
					...prune(snapshot.folders, delta.path),
					...delta.listing.folders,
				],
			};
		case "remove":
			return {
				files: prune(snapshot.files, delta.path),
				folders: prune(snapshot.folders, delta.path),
			};
		case "refresh":
			return snapshot;
	}
}
