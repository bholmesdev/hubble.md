// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewerStore } from "../store/state";
import { InboxView } from "./InboxView";

const api = vi.hoisted(() => ({ readNotePreviews: vi.fn() }));
vi.mock("../desktopApi", () => ({ desktopApi: api }));
vi.mock("@hubble.md/ui", () => ({
	SidebarFileActionsMenu: () => null,
	useCommandShortcutLabel: (label: string) => label,
}));
vi.mock("../store/state", async () => {
	const { store } = await import("@simplestack/store");
	const viewerStore = store({
		status: "idle",
		currentPath: null as string | null,
	});
	return { viewerStore, currentPathStore: viewerStore.select("currentPath") };
});

describe("inbox previews", () => {
	let container: HTMLDivElement;
	let root: Root;
	let sequence = 0;
	let paths: string[];
	beforeEach(() => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		api.readNotePreviews.mockReset();
		paths = [0, 1].map((i) => `/workspace/${sequence++}-${i}.md`);
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});
	async function render(modified = 1, currentPath: string | null = null) {
		viewerStore.set((doc) => ({ ...doc, currentPath }));
		await act(async () =>
			root.render(
				<InboxView
					workspacePath="/workspace"
					files={paths.map((path) => ({
						path,
						modified_at: modified,
						kind: "document",
					}))}
					pinnedNotes={[]}
					currentPath={currentPath}
					onOpen={() => {}}
					actions={{}}
				/>,
			),
		);
	}
	it("preserves a saved preview when its refresh fails", async () => {
		api.readNotePreviews.mockResolvedValueOnce(
			Object.fromEntries(
				paths.map((path) => [
					path,
					{ title: "Saved title", description: "Saved body" },
				]),
			),
		);
		await render();
		api.readNotePreviews.mockRejectedValueOnce(
			new Error("temporarily offline"),
		);
		await render(2);
		expect(container.textContent).toContain("Saved title");
		expect(container.textContent).toContain("Saved body");
	});
	it("rereads the note you leave even when its saved time didn't change", async () => {
		api.readNotePreviews.mockResolvedValueOnce(
			Object.fromEntries(
				paths.map((path) => [path, { title: "Before", description: null }]),
			),
		);
		await render(1, paths[0]);
		// The save on leaving landed in the same second, so the time stays 1.
		api.readNotePreviews.mockResolvedValueOnce({
			[paths[0]]: { title: "After", description: null },
		});
		await render(1, paths[1]);
		expect(api.readNotePreviews.mock.calls[1][0]).toEqual([paths[0]]);
		expect(container.textContent).toContain("After");
	});
	it("rereads a note left while the inbox wasn't showing", async () => {
		api.readNotePreviews.mockResolvedValueOnce(
			Object.fromEntries(
				paths.map((path) => [path, { title: "Before", description: null }]),
			),
		);
		await render(1, paths[0]);
		await act(async () => root.render(null));
		// Leave the note from the folder view, in the same second as its last save.
		viewerStore.set((doc) => ({ ...doc, currentPath: paths[1] }));
		api.readNotePreviews.mockResolvedValueOnce({
			[paths[0]]: { title: "After", description: null },
		});
		await render(1, paths[1]);
		expect(api.readNotePreviews.mock.calls[1][0]).toEqual([paths[0]]);
		expect(container.textContent).toContain("After");
	});
	it("continues loading later batches after an IPC batch fails", async () => {
		paths = Array.from({ length: 201 }, (_, i) => `/batch/${i}.md`);
		api.readNotePreviews.mockRejectedValueOnce(new Error("first batch failed"));
		api.readNotePreviews.mockResolvedValueOnce({
			[paths[200]]: { title: "Last batch", description: null },
		});
		await render();
		expect(container.textContent).toContain("Last batch");
		expect(api.readNotePreviews).toHaveBeenCalledTimes(2);
		expect(container.textContent).toContain("Preview unavailable");
	});
});
