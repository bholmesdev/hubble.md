import { describe, expect, it } from "vitest";
import {
	applySidebarSelection,
	type SidebarSelectionState,
	sidebarDeleteSelection,
	sidebarMoveCandidateFromRow,
	sidebarMoveItemsForDrag,
	sidebarRowKey,
	snapSidebarSelection,
} from "./Sidebar";
import type { SidebarRow } from "./useSidebarTree";

const rows: SidebarRow[] = [
	{ kind: "section", id: "pinned", label: "Pinned", depth: 0 },
	{
		kind: "file",
		file: { path: "/workspace/a.md" },
		label: "a.md",
		depth: 0,
	},
	{
		kind: "folder",
		id: "project/",
		label: "project",
		depth: 0,
		expanded: true,
		segments: [{ id: "project/", name: "project" }],
	},
	{
		kind: "file",
		file: { path: "/workspace/project/b.md" },
		label: "b.md",
		depth: 1,
	},
	{
		kind: "folder",
		id: "project/archive/",
		label: "archive",
		depth: 1,
		expanded: false,
		segments: [{ id: "project/archive/", name: "archive" }],
	},
	{
		kind: "file",
		file: { path: "/workspace/c.md" },
		label: "c.md",
		depth: 0,
	},
];

const emptySelection: SidebarSelectionState = {
	selectedKeys: new Set(),
	anchorKey: null,
};

function getDisplayPath(path: string) {
	return path.replace("/workspace/", "");
}

function rowKey(index: number) {
	return sidebarRowKey(rows[index]);
}

function select(
	selection: SidebarSelectionState,
	index: number,
	mode: "replace" | "toggle" | "range",
) {
	return applySidebarSelection({
		anchorKey: selection.anchorKey,
		mode,
		rows,
		selectedKeys: selection.selectedKeys,
		targetKey: rowKey(index),
	});
}

function candidate(index: number) {
	const item = sidebarMoveCandidateFromRow(rows[index], getDisplayPath);
	if (!item) throw new Error("Expected move candidate");
	return item;
}

describe("sidebar selection helpers", () => {
	it("toggles a single row in and out of the selection", () => {
		let selection = select(emptySelection, 1, "toggle");
		selection = select(selection, 2, "toggle");

		expect([...selection.selectedKeys]).toEqual([
			"file:/workspace/a.md",
			"folder:project/",
		]);

		selection = select(selection, 1, "toggle");

		expect([...selection.selectedKeys]).toEqual(["folder:project/"]);
		expect(selection.anchorKey).toBe("file:/workspace/a.md");
	});

	it("selects a contiguous visible range from the anchor row", () => {
		let selection = select(emptySelection, 1, "replace");
		selection = select(selection, 5, "range");

		expect([...selection.selectedKeys]).toEqual([
			"file:/workspace/a.md",
			"folder:project/",
			"file:/workspace/project/b.md",
			"folder:project/archive/",
			"file:/workspace/c.md",
		]);
		expect(selection.anchorKey).toBe("file:/workspace/a.md");
	});

	it("plain selection replaces the current selection with one row", () => {
		let selection = select(emptySelection, 1, "toggle");
		selection = select(selection, 2, "toggle");
		selection = select(selection, 5, "replace");

		expect([...selection.selectedKeys]).toEqual(["file:/workspace/c.md"]);
		expect(selection.anchorKey).toBe("file:/workspace/c.md");
	});

	it("snaps the selection to a file activated without a click", () => {
		let selection = select(emptySelection, 1, "replace");
		selection = snapSidebarSelection(selection, "/workspace/c.md");

		expect([...selection.selectedKeys]).toEqual(["file:/workspace/c.md"]);
		expect(selection.anchorKey).toBe("file:/workspace/c.md");
	});

	it("keeps the same selection object when already on the active file", () => {
		const selection = select(emptySelection, 1, "replace");

		expect(snapSidebarSelection(selection, "/workspace/a.md")).toBe(selection);
	});

	it("clears the selection when no file is active", () => {
		const selection = select(emptySelection, 1, "replace");
		const snapped = snapSidebarSelection(selection, null);

		expect(snapped.selectedKeys.size).toBe(0);
		expect(snapped.anchorKey).toBeNull();
	});

	it("ignores section rows", () => {
		const selection = select(emptySelection, 0, "replace");

		expect([...selection.selectedKeys]).toEqual([]);
		expect(selection.anchorKey).toBeNull();
	});

	it("returns all selected move items when dragging a selected row", () => {
		const selectedKeys = new Set([
			"file:/workspace/a.md",
			"file:/workspace/c.md",
		]);

		const items = sidebarMoveItemsForDrag({
			draggedItem: candidate(1),
			getDisplayPath,
			rows,
			selectedKeys,
			targetFolderId: "project/",
		});

		expect(items).toEqual([
			{ kind: "file", path: "/workspace/a.md" },
			{ kind: "file", path: "/workspace/c.md" },
		]);
	});

	it("returns only the dragged item when dragging an unselected row", () => {
		const items = sidebarMoveItemsForDrag({
			draggedItem: candidate(5),
			getDisplayPath,
			rows,
			selectedKeys: new Set(["file:/workspace/a.md"]),
			targetFolderId: "project/",
		});

		expect(items).toEqual([{ kind: "file", path: "/workspace/c.md" }]);
	});

	it("filters invalid descendant moves", () => {
		const items = sidebarMoveItemsForDrag({
			draggedItem: candidate(2),
			getDisplayPath,
			rows,
			selectedKeys: new Set(["folder:project/"]),
			targetFolderId: "project/archive/",
		});

		expect(items).toEqual([]);
	});

	it("drops descendants already covered by a selected folder", () => {
		const items = sidebarMoveItemsForDrag({
			draggedItem: candidate(2),
			getDisplayPath,
			rows,
			selectedKeys: new Set([
				"folder:project/",
				"file:/workspace/project/b.md",
			]),
			targetFolderId: "other/",
		});

		expect(items).toEqual([{ kind: "folder", folderId: "project/" }]);
	});

	it("keeps valid descendants when the selected parent cannot move", () => {
		const items = sidebarMoveItemsForDrag({
			draggedItem: candidate(2),
			getDisplayPath,
			rows,
			selectedKeys: new Set([
				"folder:project/",
				"file:/workspace/project/b.md",
			]),
			targetFolderId: "project/archive/",
		});

		expect(items).toEqual([{ kind: "file", path: "/workspace/project/b.md" }]);
	});
});

describe("sidebarDeleteSelection", () => {
	const selection = {
		files: [{ path: "/workspace/project/b.md" }, { path: "/workspace/c.md" }],
		folders: ["project/", "project/archive/"],
		count: 4,
	};

	it("drops descendants covered by an actionable folder", () => {
		expect(
			sidebarDeleteSelection(selection, getDisplayPath, true, true),
		).toEqual({
			files: [{ path: "/workspace/c.md" }],
			folders: ["project/"],
			count: 2,
		});
	});

	it("counts only types with delete handlers", () => {
		expect(
			sidebarDeleteSelection(selection, getDisplayPath, true, false),
		).toEqual({ files: selection.files, folders: [], count: 2 });
		expect(
			sidebarDeleteSelection(selection, getDisplayPath, false, true),
		).toEqual({ files: [], folders: ["project/"], count: 1 });
	});
});
