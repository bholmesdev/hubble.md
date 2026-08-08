// @vitest-environment happy-dom

import { formatCommandShortcut } from "@hubble.md/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}

async function loadWorkspaceSwitcher() {
	vi.resetModules();
	vi.stubGlobal("localStorage", {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
	});
	Object.defineProperty(window, "desktopApi", {
		value: {},
		configurable: true,
		writable: true,
	});

	const state = await import("../store/state");
	const { WorkspaceSwitcher } = await import("./WorkspaceSwitcher");
	return { ...state, WorkspaceSwitcher };
}

describe("WorkspaceSwitcher", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("removes an inactive folder without opening it and keeps the menu open", async () => {
		const { appStore, WorkspaceSwitcher, workspaceStore } =
			await loadWorkspaceSwitcher();

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
				recentWorkspaces: ["/workspace-a", "/workspace-b", "/workspace-c"],
				lastOpenedPaths: {
					"/workspace-b": "/workspace-b/remembered.md",
				},
			},
			ui: {
				...state.ui,
				isSwitcherOpen: true,
			},
		}));

		await act(async () => {
			root.render(<WorkspaceSwitcher />);
			await flush();
		});

		const removeButtons = Array.from(
			document.body.querySelectorAll<HTMLElement>("[data-remove-workspace]"),
		);
		expect(removeButtons).toHaveLength(2);
		for (const button of removeButtons) {
			expect(button.getAttribute("role")).toBeNull();
			expect(button.getAttribute("aria-hidden")).toBe("true");
			expect(button.tabIndex).toBe(-1);
		}
		expect(
			document.body.querySelector('[role="menuitem"][title="/workspace-a"]'),
		).not.toBeNull();

		await act(async () => {
			removeButtons[0]?.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
			await flush();
		});

		expect(workspaceStore.get()).toMatchObject({
			workspacePath: "/workspace-a",
			recentWorkspaces: ["/workspace-a", "/workspace-c"],
			lastOpenedPaths: {
				"/workspace-b": "/workspace-b/remembered.md",
			},
		});
		expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
		expect(
			document.body.querySelectorAll("[data-remove-workspace]"),
		).toHaveLength(1);
		expect(document.activeElement).toBe(
			document.body.querySelector('[role="menuitem"][title="/workspace-c"]'),
		);
	});

	it("removes the highlighted folder with Delete", async () => {
		const { appStore, WorkspaceSwitcher, workspaceStore } =
			await loadWorkspaceSwitcher();

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
				recentWorkspaces: ["/workspace-a", "/workspace-b"],
			},
			ui: {
				...state.ui,
				isSwitcherOpen: true,
			},
		}));

		await act(async () => {
			root.render(<WorkspaceSwitcher />);
			await flush();
		});

		const folderItem = document.body.querySelector<HTMLElement>(
			'[role="menuitem"][title="/workspace-b"]',
		);
		if (!folderItem) throw new Error("Missing folder item");
		expect(folderItem.getAttribute("aria-keyshortcuts")).toBe(
			"Delete Backspace",
		);

		await act(async () => {
			folderItem.focus();
			folderItem.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Delete",
					bubbles: true,
					cancelable: true,
				}),
			);
			await flush();
		});

		expect(workspaceStore.get().recentWorkspaces).toEqual(["/workspace-a"]);
		expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
		expect(document.activeElement).toBe(
			document.body.querySelector('[role="menuitem"][title="/workspace-a"]'),
		);
	});

	it("shows the Open Folder shortcut on Add folder", async () => {
		const { appStore, WorkspaceSwitcher } = await loadWorkspaceSwitcher();

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
				recentWorkspaces: ["/workspace-a"],
			},
			ui: {
				...state.ui,
				isSwitcherOpen: true,
			},
		}));

		await act(async () => {
			root.render(<WorkspaceSwitcher />);
			await flush();
		});

		const addFolder = Array.from(
			document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		).find((item) => item.textContent?.includes("Add folder..."));
		expect(addFolder?.textContent).toContain(
			formatCommandShortcut("app.open-folder"),
		);
	});
});
