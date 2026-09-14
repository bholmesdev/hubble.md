// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const roots: Root[] = [];
const expandedStorageKey = "hubble-sidebar-expanded-folders:test";

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
	vi.restoreAllMocks();
});

describe("Sidebar folder clicks", () => {
	it("selects an expanded folder before collapsing it on a second click", () => {
		seedExpanded("project/");
		const onSelectFile = vi.fn();
		renderSidebar(onSelectFile);

		clickRow("note.md");
		expect(onSelectFile).toHaveBeenCalledWith("/workspace/project/note.md");

		clickRow("project");
		expect(folderRow("project").getAttribute("aria-expanded")).toBe("true");
		expect(folderRow("project").getAttribute("aria-selected")).toBe("true");
		expect(row("note.md")).not.toBeNull();

		clickRow("project");
		expect(folderRow("project").getAttribute("aria-expanded")).toBe("false");
		expect(row("note.md")).toBeNull();
		expect(onSelectFile).toHaveBeenCalledTimes(1);
	});

	it("expands a collapsed folder on the first row click", () => {
		renderSidebar();

		clickRow("archive");
		expect(folderRow("archive").getAttribute("aria-expanded")).toBe("true");
		expect(folderRow("archive").getAttribute("aria-selected")).toBe("true");
		expect(row("old.md")).not.toBeNull();
	});

	it("keeps folders expanded after row and chevron double clicks", () => {
		renderSidebar();

		clickRow("archive");
		clickRow("archive", { detail: 2 });
		expect(folderRow("archive").getAttribute("aria-expanded")).toBe("true");

		clickFolderToggle("project");
		clickFolderToggle("project", { detail: 2 });
		expect(folderRow("project").getAttribute("aria-expanded")).toBe("true");
	});

	it("collapses an expanded folder immediately from its chevron", () => {
		seedExpanded("project/");
		renderSidebar();

		clickRow("note.md");
		clickFolderToggle("project");

		expect(folderRow("project").getAttribute("aria-expanded")).toBe("false");
		expect(row("note.md")).toBeNull();
	});

	it("reduces a multi-selection before collapsing a folder", () => {
		seedExpanded("project/", "archive/");
		renderSidebar();

		clickRow("project");
		clickRow("archive", { ctrlKey: true });
		expect(folderRow("archive").getAttribute("aria-expanded")).toBe("true");

		clickRow("project");
		expect(folderRow("project").getAttribute("aria-expanded")).toBe("true");
		expect(folderRow("archive").getAttribute("aria-selected")).toBe("false");

		clickRow("project");
		expect(folderRow("project").getAttribute("aria-expanded")).toBe("false");
	});
});

function seedExpanded(...folderIds: string[]) {
	localStorage.setItem(expandedStorageKey, JSON.stringify(folderIds));
}

function renderSidebar(onSelectFile: (path: string) => void = () => {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => {
		root.render(
			<Sidebar
				files={[
					{ path: "/workspace/project/note.md" },
					{ path: "/workspace/archive/old.md" },
				]}
				currentPath={null}
				getDisplayPath={(path) => path.replace("/workspace/", "")}
				onSelectFile={onSelectFile}
				onSortModeChange={() => {}}
				sortMode="alpha"
				storageScope="test"
			/>,
		);
	});
}

function row(label: string) {
	return document.querySelector<HTMLElement>(
		`[role="treeitem"][title="${label}"]`,
	);
}

function folderRow(label: string) {
	const element = row(label);
	if (!element) throw new Error(`Missing folder row ${label}`);
	return element;
}

function clickRow(label: string, init: MouseEventInit = {}) {
	const button = row(label)?.querySelector("button");
	if (!button) throw new Error(`Missing row button ${label}`);
	dispatchClick(button, init);
}

function clickFolderToggle(label: string, init: MouseEventInit = {}) {
	const toggle = row(label)?.querySelector("[data-sidebar-folder-toggle]");
	if (!toggle) throw new Error(`Missing folder toggle ${label}`);
	dispatchClick(toggle, init);
}

function dispatchClick(target: Element, init: MouseEventInit) {
	act(() => {
		target.dispatchEvent(
			new MouseEvent("click", { bubbles: true, detail: 1, ...init }),
		);
	});
}
