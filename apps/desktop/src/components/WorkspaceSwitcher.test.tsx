// @vitest-environment happy-dom

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

		const removeItems = Array.from(
			document.body.querySelectorAll<HTMLElement>(
				'[role="menuitem"][aria-label="Remove from list"]',
			),
		);
		expect(removeItems).toHaveLength(2);
		expect(
			document.body.querySelector('[role="menuitem"][title="/workspace-a"]'),
		).not.toBeNull();

		await act(async () => {
			removeItems[0]?.dispatchEvent(
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
			document.body.querySelectorAll(
				'[role="menuitem"][aria-label="Remove from list"]',
			),
		).toHaveLength(1);
		expect(document.activeElement).toBe(
			document.body.querySelector('[role="menuitem"][title="/workspace-c"]'),
		);
	});

	it("moves focus to the previous folder after removing the final folder", async () => {
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

		const removeItem = document.body.querySelector<HTMLElement>(
			'[role="menuitem"][aria-label="Remove from list"]',
		);
		if (!removeItem) throw new Error("Missing remove action");

		await act(async () => {
			removeItem.focus();
			removeItem.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
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
});
