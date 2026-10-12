// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildFileTree,
	flattenRows,
	type SidebarFile,
	type SidebarRow,
	type SidebarSortMode,
	useSidebarTree,
} from "./useSidebarTree";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

type TreeProps = Parameters<typeof useSidebarTree>[0];
type TreeResult = ReturnType<typeof useSidebarTree>;

const roots: Root[] = [];
const getDisplayPath = (path: string) => path.replace("/workspace/", "");

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	localStorage.clear();
	document.body.replaceChildren();
});

function folderNames(node: ReturnType<typeof buildFileTree>) {
	return [...node.folders.values()].map((folder) => folder.name);
}

describe("buildFileTree", () => {
	it("includes empty folders from directory entries", () => {
		const tree = buildFileTree([], [{ path: "/workspace/empty" }], (path) =>
			path.replace("/workspace/", ""),
		);

		expect(folderNames(tree)).toEqual(["empty"]);
		expect(tree.folders.get("empty")?.files).toEqual([]);
	});

	it("includes folder-only nested hierarchies from directory entries", () => {
		const tree = buildFileTree(
			[],
			[{ path: "/workspace/parent" }, { path: "/workspace/parent/child" }],
			(path) => path.replace("/workspace/", ""),
		);

		const parent = tree.folders.get("parent");
		expect(parent?.folders.get("child")?.files).toEqual([]);
	});

	it("does not render asset folders when listing omits them", () => {
		const tree = buildFileTree(
			[{ path: "/workspace/note.md", modifiedAt: 1 }],
			[],
			(path) => path.replace("/workspace/", ""),
		);

		expect(folderNames(tree)).toEqual([]);
	});
});

describe("flattenRows", () => {
	it("keeps a newly-created nested folder uncollapsed while naming", () => {
		const getDisplayPath = (path: string) => path.replace("/workspace/", "");
		const tree = buildFileTree(
			[],
			[{ path: "/workspace/empty" }, { path: "/workspace/empty/new-folder" }],
			getDisplayPath,
		);

		const rows = flattenRows({
			files: [],
			getDisplayPath,
			tree,
			sortMode: "alpha",
			expandedFolders: new Set(["empty/"]),
			uncompactFolderId: "empty/new-folder/",
		});

		expect(rows.map((row) => row.label)).toEqual(["empty", "new-folder"]);
	});

	it("collapses the nested folder chain after naming commits", () => {
		const getDisplayPath = (path: string) => path.replace("/workspace/", "");
		const tree = buildFileTree(
			[],
			[{ path: "/workspace/empty" }, { path: "/workspace/empty/new-folder" }],
			getDisplayPath,
		);

		const rows = flattenRows({
			files: [],
			getDisplayPath,
			tree,
			sortMode: "alpha",
			expandedFolders: new Set(["empty/"]),
		});

		expect(rows.map((row) => row.label)).toEqual(["empty/new-folder"]);
	});

	it.each([
		["recent", ["alpha.md", "charlie.md", "bravo.md"]],
		["alpha", ["alpha.md", "bravo.md", "charlie.md"]],
	] satisfies [
		SidebarSortMode,
		string[],
	][])("sorts files by %s", (sortMode, expected) => {
		const files = [
			{ path: "/workspace/alpha.md", modifiedAt: 30 },
			{ path: "/workspace/bravo.md", modifiedAt: 10 },
			{ path: "/workspace/charlie.md", modifiedAt: 20 },
		];
		const tree = buildFileTree(files, [], getDisplayPath);

		const rows = flattenRows({
			files,
			getDisplayPath,
			tree,
			sortMode,
			expandedFolders: new Set(),
		});

		expect(fileLabels(rows)).toEqual(expected);
	});

	it.each([
		"recent",
		"alpha",
	] satisfies SidebarSortMode[])("keeps folders alphabetical at every depth with %s file order", (sortMode) => {
		const files = [
			{ path: "/workspace/02 Stuff/new.md", modifiedAt: 30 },
			{ path: "/workspace/00 Index/old.md", modifiedAt: 10 },
		];
		const folders = [
			{ path: "/workspace/Parent/02 Stuff" },
			{ path: "/workspace/Parent/00 Index" },
			{ path: "/workspace/02 Stuff" },
			{ path: "/workspace/00 Index" },
			{ path: "/workspace/Parent" },
		];
		const tree = buildFileTree(files, folders, getDisplayPath);

		const rows = flattenRows({
			files,
			getDisplayPath,
			tree,
			sortMode,
			expandedFolders: new Set(["Parent/"]),
		});

		expect(folderLabels(rows, 0)).toEqual(["00 Index", "02 Stuff", "Parent"]);
		expect(folderLabels(rows, 1)).toEqual(["00 Index", "02 Stuff"]);
	});

	it("sorts numeric names naturally", () => {
		const files = [
			{ path: "/workspace/10 Notes.md" },
			{ path: "/workspace/2 Notes.md" },
		];
		const tree = buildFileTree(
			files,
			[{ path: "/workspace/10 Archive" }, { path: "/workspace/2 Archive" }],
			getDisplayPath,
		);

		const rows = flattenRows({
			files,
			getDisplayPath,
			tree,
			sortMode: "alpha",
			expandedFolders: new Set(),
		});

		expect(folderLabels(rows, 0)).toEqual(["2 Archive", "10 Archive"]);
		expect(fileLabels(rows)).toEqual(["2 Notes.md", "10 Notes.md"]);
	});

	it("uses the selected file order for pinned files", () => {
		const files = [
			{ path: "/workspace/alpha.md", modifiedAt: 10, pinned: true },
			{ path: "/workspace/bravo.md", modifiedAt: 30, pinned: true },
		];
		const tree = buildFileTree(files, [], getDisplayPath);

		const rows = flattenRows({
			files,
			getDisplayPath,
			tree,
			sortMode: "recent",
			expandedFolders: new Set(),
		});

		expect(fileLabels(rows)).toEqual(["bravo.md", "alpha.md"]);
	});
});

describe("useSidebarTree", () => {
	it("keeps selected-file ancestors collapsed across unrelated rerenders", () => {
		const harness = renderTree({
			files: nestedFiles,
			highlightPath: "/workspace/alpha/beta/one.md",
		});

		expect(filePaths(harness.current.rows)).toContain(
			"/workspace/alpha/beta/one.md",
		);

		act(() => harness.current.collapseFolder("alpha/beta/"));
		expect(filePaths(harness.current.rows)).not.toContain(
			"/workspace/alpha/beta/one.md",
		);

		harness.rerender({ files: [...nestedFiles] });

		expect(filePaths(harness.current.rows)).not.toContain(
			"/workspace/alpha/beta/one.md",
		);
		expect(folderRow(harness.current.rows, "alpha/beta/").expanded).toBe(false);
	});

	it("auto-expands the ancestor chain when highlightPath changes", () => {
		const harness = renderTree({
			files: nestedFiles,
			highlightPath: "/workspace/alpha/beta/one.md",
		});

		harness.rerender({
			highlightPath: "/workspace/gamma/delta/two.md",
		});

		expect(filePaths(harness.current.rows)).toContain(
			"/workspace/gamma/delta/two.md",
		);
		expect(folderRow(harness.current.rows, "gamma/delta/").expanded).toBe(true);
	});

	it("expands and collapses every folder", () => {
		const harness = renderTree({
			files: nestedFiles,
			highlightPath: null,
			storageScope: "workspace",
		});

		expect(harness.current.hasFolders).toBe(true);
		expect(harness.current.hasExpandedFolders).toBe(false);

		act(() => harness.current.expandAllFolders());

		expect(harness.current.hasExpandedFolders).toBe(true);
		expect(filePaths(harness.current.rows)).toEqual([
			"/workspace/alpha/beta/one.md",
			"/workspace/gamma/delta/two.md",
		]);
		expect(
			JSON.parse(
				localStorage.getItem("hubble-sidebar-expanded-folders:workspace") ??
					"[]",
			),
		).toEqual(["alpha/", "alpha/beta/", "gamma/", "gamma/delta/"]);

		act(() => harness.current.collapseAllFolders());

		expect(harness.current.hasExpandedFolders).toBe(false);
		expect(filePaths(harness.current.rows)).toEqual([]);
		expect(
			localStorage.getItem("hubble-sidebar-expanded-folders:workspace"),
		).toBe("[]");
	});

	it("reports when the tree has no folders", () => {
		const harness = renderTree({
			files: [{ path: "/workspace/note.md" }],
		});

		expect(harness.current.hasFolders).toBe(false);
		expect(harness.current.hasExpandedFolders).toBe(false);
	});
});

const nestedFiles: SidebarFile[] = [
	{ path: "/workspace/alpha/beta/one.md", modifiedAt: 1 },
	{ path: "/workspace/gamma/delta/two.md", modifiedAt: 2 },
];

function renderTree(overrides: Partial<TreeProps>) {
	let props: TreeProps = {
		files: [],
		getDisplayPath,
		highlightPath: null,
		sortMode: "alpha",
		...overrides,
	};
	let current: TreeResult | null = null;
	const rootElement = document.createElement("div");
	document.body.append(rootElement);
	const root = createRoot(rootElement);
	roots.push(root);

	function Harness() {
		current = useSidebarTree(props);
		return null;
	}

	const render = () => {
		act(() => root.render(createElement(Harness)));
	};
	render();

	return {
		get current(): TreeResult {
			if (!current) throw new Error("Hook did not render");
			return current;
		},
		rerender(next: Partial<TreeProps>) {
			props = { ...props, ...next };
			render();
		},
	};
}

function filePaths(rows: SidebarRow[]) {
	return rows.flatMap((row) => (row.kind === "file" ? [row.file.path] : []));
}

function fileLabels(rows: SidebarRow[]) {
	return rows.flatMap((row) => (row.kind === "file" ? [row.label] : []));
}

function folderLabels(rows: SidebarRow[], depth: number) {
	return rows.flatMap((row) =>
		row.kind === "folder" && row.depth === depth ? [row.label] : [],
	);
}

function folderRow(rows: SidebarRow[], id: string) {
	const row = rows.find((row) => row.kind === "folder" && row.id === id);
	if (!row || row.kind !== "folder") throw new Error(`Missing folder ${id}`);
	return row;
}
