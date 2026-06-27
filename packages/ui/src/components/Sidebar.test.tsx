// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar, type SidebarFolder } from "./Sidebar";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
	if (root) {
		act(() => root?.unmount());
	}
	root = null;
	container?.remove();
	container = null;
	vi.restoreAllMocks();
});

function renderSidebar({
	folders = [],
	onCreateFolder,
	onDeleteFolder = vi.fn(),
	onRenameFolder = vi.fn(),
}: {
	folders?: SidebarFolder[];
	onCreateFolder: (folderId: string | null) => Promise<string | null>;
	onDeleteFolder?: (folderId: string) => void;
	onRenameFolder?: (
		folderId: string,
		nextName: string,
		targetDisplayPath: string,
	) => void;
}) {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);

	act(() => {
		root?.render(
			<Sidebar
				files={[]}
				folders={folders}
				currentPath={null}
				sortMode="alpha"
				getDisplayPath={(path) => path.replace("/workspace/", "")}
				onCreateFolder={onCreateFolder}
				onDeleteFolder={onDeleteFolder}
				onRenameFolder={onRenameFolder}
				onSelectFile={vi.fn()}
				onSortModeChange={vi.fn()}
			/>,
		);
	});

	return { container };
}

async function click(element: Element) {
	await act(async () => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

async function change(input: HTMLInputElement, value: string) {
	const valueSetter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		valueSetter?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function keyDown(input: HTMLInputElement, key: string) {
	await act(async () => {
		input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
	});
}

function renameInput() {
	expect(document.activeElement).toBeInstanceOf(HTMLInputElement);
	return document.activeElement as HTMLInputElement;
}

describe("Sidebar new folder", () => {
	it("creates a folder from the header and commits inline naming", async () => {
		const onCreateFolder = vi.fn(async () => "/workspace/new-folder");
		const onRenameFolder = vi.fn();

		const { container } = renderSidebar({
			folders: [{ path: "/workspace/new-folder", modifiedAt: 1 }],
			onCreateFolder,
			onRenameFolder,
		});

		const newFolderButton = container.querySelector(
			'button[aria-label="New folder"]',
		);
		expect(newFolderButton).toBeInstanceOf(HTMLButtonElement);

		await click(newFolderButton as HTMLButtonElement);

		const input = renameInput();
		expect(input.value).toBe("new-folder");

		await change(input, "Plans");
		await keyDown(input, "Enter");

		expect(onCreateFolder).toHaveBeenCalledWith(null);
		expect(onRenameFolder).toHaveBeenCalledWith(
			"new-folder/",
			"Plans",
			"Plans",
		);
	});

	it("deletes the new empty folder when header inline naming is canceled", async () => {
		const onCreateFolder = vi.fn(async () => "/workspace/new-folder");
		const onDeleteFolder = vi.fn();

		const { container } = renderSidebar({
			folders: [{ path: "/workspace/new-folder", modifiedAt: 1 }],
			onCreateFolder,
			onDeleteFolder,
		});

		const newFolderButton = container.querySelector(
			'button[aria-label="New folder"]',
		);
		expect(newFolderButton).toBeInstanceOf(HTMLButtonElement);

		await click(newFolderButton as HTMLButtonElement);

		const input = renameInput();

		await keyDown(input, "Escape");

		expect(onDeleteFolder).toHaveBeenCalledWith("new-folder/");
	});
});
