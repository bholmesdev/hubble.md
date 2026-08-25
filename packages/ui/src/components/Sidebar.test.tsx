// @vitest-environment happy-dom

import { act, type ComponentProps, type ReactNode, useState } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar, type SidebarFile } from "./Sidebar";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};
type RenameFile = NonNullable<ComponentProps<typeof Sidebar>["onRenameFile"]>;

const roots: Root[] = [];

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	document.body.replaceChildren();
});

describe("Sidebar", () => {
	it("continues editing after a new note name is submitted", async () => {
		const onRenameFile = vi.fn();
		renderSidebar(onRenameFile);

		await act(async () => newFileButton().click());
		await act(async () => {
			newNoteMenuItem().click();
			await Promise.resolve();
		});

		const input = renameInput("new-file");
		act(() => {
			setInputValue(input, "daily-notes");
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(onRenameFile).toHaveBeenCalledWith(
			"/workspace/new-file.md",
			"daily-notes",
			{ origin: "new-note", commit: "enter" },
		);
	});

	it("returns to the sidebar after an existing note is renamed", () => {
		const onRenameFile = vi.fn();
		renderSidebar(onRenameFile, [
			{ path: "/workspace/existing.md", modifiedAt: 1 },
		]);

		act(() => {
			existingNoteButton().dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
			);
		});
		const input = renameInput("existing");
		act(() => {
			setInputValue(input, "renamed");
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(onRenameFile).toHaveBeenCalledWith(
			"/workspace/existing.md",
			"renamed",
			{ origin: "rename", commit: "enter" },
		);
	});

	it("returns to the sidebar after a new HTML app is named", async () => {
		const onRenameFile = vi.fn();
		renderSidebar(onRenameFile);

		await act(async () => newFileButton().click());
		await act(async () => {
			newHtmlMenuItem().click();
			await Promise.resolve();
		});

		const input = renameInput("new-app");
		act(() => {
			setInputValue(input, "dashboard");
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(onRenameFile).toHaveBeenCalledWith(
			"/workspace/new-app.html",
			"dashboard",
			{ origin: "new-html", commit: "enter" },
		);
	});
});

function renderSidebar(
	onRenameFile: RenameFile,
	initialFiles: SidebarFile[] = [],
) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<SidebarHarness
				onRenameFile={onRenameFile}
				initialFiles={initialFiles}
			/>,
		),
	);
}

function SidebarHarness({
	onRenameFile,
	initialFiles,
}: {
	onRenameFile: RenameFile;
	initialFiles: SidebarFile[];
}) {
	const [files, setFiles] = useState(initialFiles);
	return (
		<Sidebar
			files={files}
			currentPath={null}
			sortMode="alpha"
			getDisplayPath={(path) => path.replace("/workspace/", "")}
			onSortModeChange={() => {}}
			onSelectFile={() => {}}
			onRenameFile={onRenameFile}
			onCreateFile={async () => {
				const path = "/workspace/new-file.md";
				setFiles([{ path, modifiedAt: 1 }]);
				return path;
			}}
			onCreateHtmlFile={async () => {
				const path = "/workspace/new-app.html";
				setFiles([{ path, modifiedAt: 1 }]);
				return path;
			}}
		/>
	);
}

function newFileButton() {
	const button = document.querySelector<HTMLButtonElement>(
		'button[aria-label="New file"]',
	);
	if (!button) throw new Error("Missing new file button");
	return button;
}

function newNoteMenuItem() {
	const item = Array.from(
		document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	).find((element) => element.textContent?.includes("New Note"));
	if (!item) throw new Error("Missing New Note menu item");
	return item;
}

function newHtmlMenuItem() {
	const item = Array.from(
		document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	).find((element) => element.textContent?.includes("New HTML App"));
	if (!item) throw new Error("Missing New HTML App menu item");
	return item;
}

function existingNoteButton() {
	const button = Array.from(
		document.querySelectorAll<HTMLButtonElement>("button"),
	).find((element) => element.textContent?.trim() === "existing.md");
	if (!button) throw new Error("Missing existing note button");
	return button;
}

function renameInput(value: string) {
	const input = Array.from(
		document.querySelectorAll<HTMLInputElement>("input"),
	).find((element) => element.value === value);
	if (!input) throw new Error("Missing rename input");
	return input;
}

function setInputValue(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}
