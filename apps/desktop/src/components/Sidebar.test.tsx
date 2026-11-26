// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi } from "../desktopApi/types";
import { createDesktopApi } from "../store/testUtils";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	vi.unstubAllGlobals();
});

it.each([
	{ metaKey: true, ctrlKey: false, target: "/workspace/b.md", existing: true },
	{ metaKey: true, ctrlKey: false, target: "/workspace/c.md", existing: false },
	{ metaKey: false, ctrlKey: true, target: "/workspace/b.md", existing: true },
	{ metaKey: false, ctrlKey: true, target: "/workspace/c.md", existing: false },
])("keeps the active note on Inbox modifier-click (meta: $metaKey, existing: $existing)", async ({
	metaKey,
	ctrlKey,
	target,
	existing,
}) => {
	vi.resetModules();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	localStorage.clear();
	const api = {
		...createDesktopApi(),
		platform: "darwin",
		readNotePreviews: vi.fn(async () => ({})),
	};
	api.pathExists.mockResolvedValue(true);
	api.listDirectory.mockResolvedValue({
		files: ["a", "b", "c"].map((name) => ({
			path: `/workspace/${name}.md`,
			modified_at: 1,
			kind: "document",
		})),
		folders: [],
	});
	window.desktopApi = api as unknown as DesktopApi;
	const actions = await import("../store/actions");
	const { tabsStore } = await import("../store/tabStore");
	const { viewerStore, sidebarViewStore } = await import("../store/state");
	await actions.openWorkspace("/workspace");
	await actions.loadPath("/workspace/a.md");
	const first = tabsStore.get().activeTabId;
	await actions.openTabForPath("/workspace/b.md");
	if (!first) throw Error("Missing active tab");
	await actions.activateTab(first);
	actions.setSidebarOpen(true);
	sidebarViewStore.set("inbox");
	const { Sidebar } = await import("./Sidebar");
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root?.render(<Sidebar />));
	const row = host.querySelector<HTMLButtonElement>(
		`[data-inbox-path="${target}"]`,
	);
	if (!row) throw Error("Missing Inbox row");
	api.readFileText.mockClear();
	await act(async () => {
		row.dispatchEvent(
			new MouseEvent("click", { bubbles: true, metaKey, ctrlKey }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(tabsStore.get().activeTabId).toBe(first);
	expect(viewerStore.get().currentPath).toBe("/workspace/a.md");
	expect(tabsStore.get().order).toHaveLength(existing ? 2 : 3);
	expect(api.readFileText).not.toHaveBeenCalled();
});
