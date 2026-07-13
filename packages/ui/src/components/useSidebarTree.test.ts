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
		const tree = buildFileTree(
			[],
			[{ path: "/workspace/empty", modifiedAt: 3 }],
			(path) => path.replace("/workspace/", ""),
		);

		expect(folderNames(tree)).toEqual(["empty"]);
		expect(tree.folders.get("empty")?.files).toEqual([]);
	});

	it("includes folder-only nested hierarchies from directory entries", () => {
		const tree = buildFileTree(
			[],
			[
				{ path: "/workspace/parent", modifiedAt: 1 },
				{ path: "/workspace/parent/child", modifiedAt: 2 },
			],
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
			[
				{ path: "/workspace/empty", modifiedAt: 1 },
				{ path: "/workspace/empty/new-folder", modifiedAt: 2 },
			],
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
			[
				{ path: "/workspace/empty", modifiedAt: 1 },
				{ path: "/workspace/empty/new-folder", modifiedAt: 2 },
			],
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

function folderRow(rows: SidebarRow[], id: string) {
	const row = rows.find((row) => row.kind === "folder" && row.id === id);
	if (!row || row.kind !== "folder") throw new Error(`Missing folder ${id}`);
	return row;
}
