// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockTerminal {
	options: Record<string, unknown> = {};
	write = vi.fn();
	focus = vi.fn();
	open = vi.fn();
	loadAddon = vi.fn();
	dispose = vi.fn();
	onData(_callback: (data: string) => void) {
		return { dispose: vi.fn() };
	}
	onResize(_callback: (size: { cols: number; rows: number }) => void) {
		return { dispose: vi.fn() };
	}
}

class MockFitAddon {
	fit = vi.fn();
}

vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn(() => new MockTerminal()),
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: vi.fn(() => new MockFitAddon()),
}));

type TerminalEventCallback = () => void;
type TerminalDataCallback = (data: string) => void;

type MockDesktopApi = {
	terminalStart: ReturnType<typeof vi.fn>;
	terminalStop: ReturnType<typeof vi.fn>;
	terminalWrite: ReturnType<typeof vi.fn>;
	terminalResize: ReturnType<typeof vi.fn>;
	onTerminalData: ReturnType<typeof vi.fn>;
	onTerminalExit: ReturnType<typeof vi.fn>;
};

function createDesktopApi() {
	let nextSessionId = 0;
	const exitListeners = new Map<string, Set<TerminalEventCallback>>();
	const dataListeners = new Map<string, Set<TerminalDataCallback>>();

	const api: MockDesktopApi = {
		terminalStart: vi.fn(async () => `term-${++nextSessionId}`),
		terminalStop: vi.fn(async (_sessionId: string) => {}),
		terminalWrite: vi.fn(async (_sessionId: string, _data: string) => {}),
		terminalResize: vi.fn(
			async (_sessionId: string, _cols: number, _rows: number) => {},
		),
		onTerminalData: vi.fn(
			(sessionId: string, callback: TerminalDataCallback) => {
				const listeners = dataListeners.get(sessionId) ?? new Set();
				listeners.add(callback);
				dataListeners.set(sessionId, listeners);
				return () => listeners.delete(callback);
			},
		),
		onTerminalExit: vi.fn(
			(sessionId: string, callback: TerminalEventCallback) => {
				const listeners = exitListeners.get(sessionId) ?? new Set();
				listeners.add(callback);
				exitListeners.set(sessionId, listeners);
				return () => listeners.delete(callback);
			},
		),
	};

	return {
		api,
		emitExit(sessionId: string) {
			for (const callback of exitListeners.get(sessionId) ?? []) {
				callback();
			}
		},
	};
}

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}

function getButtonByLabel(container: HTMLElement, label: string) {
	const button = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	if (!button) throw new Error(`Missing button with aria-label: ${label}`);
	return button;
}

function getButtonByTitle(container: HTMLElement, title: string) {
	const button = container.querySelector<HTMLButtonElement>(
		`button[title="${title}"]`,
	);
	if (!button) throw new Error(`Missing button with title: ${title}`);
	return button;
}

function getSessionButtons(container: HTMLElement) {
	return Array.from(
		container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
	);
}

async function loadTerminalPanel(api: MockDesktopApi) {
	vi.resetModules();
	vi.stubGlobal("localStorage", {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
	});
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
			unobserve() {}
		},
	);

	Object.defineProperty(window, "desktopApi", {
		value: api,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		value: vi.fn(() => null),
		configurable: true,
	});

	const state = await import("../store/state");
	state.launchFileSettledStore.set(true);
	const actions = await import("../store/actions");
	const { TerminalPanel } = await import("./TerminalPanel");
	return { ...actions, ...state, TerminalPanel };
}

describe("TerminalPanel", () => {
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

	it("starts a terminal session when the panel is opened for a workspace", async () => {
		const { api } = createDesktopApi();
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		expect(api.terminalStart).toHaveBeenCalledWith("/workspace-a", {});
	});

	it("starts one chat session with the pending command when opened", async () => {
		const { api } = createDesktopApi();
		const { appStore, requestChatAboutNote, setChatCommand, TerminalPanel } =
			await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			document: {
				...state.document,
				currentPath: "/workspace-a/note.md",
			},
		}));
		setChatCommand("claude --continue");
		requestChatAboutNote();

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		expect(api.terminalStart).toHaveBeenCalledTimes(1);
		expect(api.terminalStart).toHaveBeenCalledWith("/workspace-a", {
			notePath: "/workspace-a/note.md",
			initialCommand: "claude --continue",
		});
		expect(api.terminalWrite).not.toHaveBeenCalled();
		expect(getSessionButtons(container)[0]?.textContent).toBe("claude");
		expect(appStore.get().ui.pendingTerminalCommand).toBeNull();
	});

	it("starts one chat session when requested after the panel has mounted closed", async () => {
		const { api } = createDesktopApi();
		const { appStore, requestChatAboutNote, setChatCommand, TerminalPanel } =
			await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			document: {
				...state.document,
				currentPath: "/workspace-a/note.md",
			},
		}));
		setChatCommand("claude --continue");

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});
		expect(api.terminalStart).not.toHaveBeenCalled();

		await act(async () => {
			requestChatAboutNote();
			await flush();
		});

		expect(api.terminalStart).toHaveBeenCalledTimes(1);
		expect(api.terminalStart).toHaveBeenCalledWith("/workspace-a", {
			notePath: "/workspace-a/note.md",
			initialCommand: "claude --continue",
		});
		expect(getSessionButtons(container)[0]?.textContent).toBe("claude");
		expect(appStore.get().ui.pendingTerminalCommand).toBeNull();
	});

	it("waits for the launch file before starting the first session", async () => {
		const { api } = createDesktopApi();
		const { appStore, launchFileSettledStore, TerminalPanel } =
			await loadTerminalPanel(api);
		launchFileSettledStore.set(false);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			document: {
				...state.document,
				currentPath: "/workspace-a/restored.md",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});
		expect(api.terminalStart).not.toHaveBeenCalled();
		expect(getButtonByLabel(container, "New Terminal").disabled).toBe(true);

		await act(async () => {
			appStore.set((state) => ({
				...state,
				document: { ...state.document, currentPath: "/elsewhere/opened.md" },
			}));
			launchFileSettledStore.set(true);
			await flush();
		});

		expect(api.terminalStart).toHaveBeenCalledTimes(1);
		expect(api.terminalStart).toHaveBeenCalledWith("/workspace-a", {
			notePath: "/elsewhere/opened.md",
		});
	});

	it("shows an error state when the shell backend fails to load", async () => {
		const { api } = createDesktopApi();
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		api.terminalStart.mockRejectedValueOnce(
			new Error("The bundled shell module (node-pty) failed to load."),
		);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		expect(container.textContent).toContain("Terminal unavailable");
		expect(appStore.get().ui.isTerminalOpen).toBe(true);
		expect(getSessionButtons(container)).toHaveLength(0);
	});

	it("drops a session that finishes starting after a workspace switch", async () => {
		const { api } = createDesktopApi();
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		let resolveStaleStart: (sessionId: string) => void = () => {};
		api.terminalStart.mockImplementationOnce(
			() =>
				new Promise<string>((resolve) => {
					resolveStaleStart = resolve;
				}),
		);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});
		expect(api.terminalStart).toHaveBeenNthCalledWith(1, "/workspace-a", {});

		// Switch workspaces while the first shell is still starting.
		await act(async () => {
			appStore.set((state) => ({
				...state,
				workspace: {
					...state.workspace,
					workspacePath: "/workspace-b",
				},
			}));
			await flush();
		});

		await act(async () => {
			resolveStaleStart("term-stale");
			await flush();
		});

		expect(api.terminalStop).toHaveBeenCalledWith("term-stale");
		expect(api.terminalStart).toHaveBeenNthCalledWith(2, "/workspace-b", {});
		const sessionTitles = getSessionButtons(container).map(
			(button) => button.textContent,
		);
		expect(sessionTitles).toEqual(["bash"]);
	});

	it("tears down prior sessions when switching workspaces", async () => {
		const desktop = createDesktopApi();
		const { api, emitExit } = desktop;
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		expect(api.terminalStart).toHaveBeenNthCalledWith(1, "/workspace-a", {});

		await act(async () => {
			appStore.set((state) => ({
				...state,
				workspace: {
					...state.workspace,
					workspacePath: "/workspace-b",
				},
			}));
			await flush();
		});

		expect(api.terminalStop).toHaveBeenCalledWith("term-1");
		expect(api.terminalStart).toHaveBeenNthCalledWith(2, "/workspace-b", {});

		// Late exit events from the old workspace should be harmless after reset.
		await act(async () => {
			emitExit("term-1");
			await flush();
		});

		expect(api.terminalStart).toHaveBeenCalledTimes(2);
	});

	it("removes the last session and closes the panel when the shell exits", async () => {
		const desktop = createDesktopApi();
		const { api, emitExit } = desktop;
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		await act(async () => {
			emitExit("term-1");
			await flush();
		});

		expect(appStore.get().ui.isTerminalOpen).toBe(false);
	});

	it("keeps another tab active when the current tab exits", async () => {
		const desktop = createDesktopApi();
		const { api, emitExit } = desktop;
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		await act(async () => {
			getButtonByTitle(container, "New Terminal").click();
			await flush();
		});

		expect(api.terminalStart).toHaveBeenNthCalledWith(1, "/workspace-a", {});
		expect(api.terminalStart).toHaveBeenNthCalledWith(2, "/workspace-a", {});
		expect(getSessionButtons(container)).toHaveLength(2);
		expect(getSessionButtons(container)[1]?.getAttribute("aria-pressed")).toBe(
			"true",
		);

		await act(async () => {
			emitExit("term-2");
			await flush();
		});

		expect(getSessionButtons(container)).toHaveLength(1);
		expect(getSessionButtons(container)[0]?.getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(appStore.get().ui.isTerminalOpen).toBe(true);
	});

	it("closes the last tab from the close button", async () => {
		const { api } = createDesktopApi();
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		await act(async () => {
			getButtonByLabel(container, "Close terminal session bash").click();
			await flush();
		});

		expect(api.terminalStop).toHaveBeenCalledWith("term-1");
		expect(appStore.get().ui.isTerminalOpen).toBe(false);
	});

	it("renames a tab from a double click on its title", async () => {
		const { api } = createDesktopApi();
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		await act(async () => {
			getSessionButtons(container)[0]?.dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true }),
			);
			await flush();
		});

		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Rename terminal session"]',
		);
		if (!input) throw new Error("Missing rename input");
		expect(input.value).toBe("bash");

		await act(async () => {
			const setValue = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setValue?.call(input, "build");
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await flush();
		});

		expect(getSessionButtons(container)[0]?.textContent).toBe("build");
		expect(
			container.querySelector('input[aria-label="Rename terminal session"]'),
		).toBeNull();
	});

	it("collapses the panel without stopping the running session", async () => {
		const { api } = createDesktopApi();
		const { appStore, TerminalPanel } = await loadTerminalPanel(api);

		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				workspacePath: "/workspace-a",
			},
			ui: {
				...state.ui,
				isTerminalOpen: true,
			},
		}));

		await act(async () => {
			root.render(<TerminalPanel />);
			await flush();
		});

		await act(async () => {
			getButtonByTitle(container, "Close Terminal Panel").click();
			await flush();
		});

		expect(appStore.get().ui.isTerminalOpen).toBe(false);
		expect(api.terminalStop).not.toHaveBeenCalled();
	});
});
