import type { Editor } from "tldraw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopApi, loadStoreActions } from "./testUtils";

afterEach(() => vi.unstubAllGlobals());

async function setup() {
	const api = createDesktopApi();
	const path = "/workspace/flow.tldr";
	const draft = '{"records":[{"typeName":"shape","id":"shape:latest"}]}';
	const files = new Map([
		[path, ""],
		["/workspace/note.md", "# Note"],
	]);
	api.pathExists.mockResolvedValue(true);
	api.readFileText.mockImplementation(
		async (path: string) => files.get(path) ?? "",
	);
	api.writeFileText.mockImplementation(
		async (path: string, content: string) => {
			files.set(path, content);
		},
	);
	api.renameFile.mockImplementation(async (from: string, to: string) => {
		files.set(to, files.get(from) ?? "");
		files.delete(from);
	});
	const actions = await loadStoreActions(api);
	await actions.loadPath(path);
	const { setActiveDiagram } = await import("../editor/diagramCommands");
	setActiveDiagram({ isDisposed: false } as Editor, path, () => draft);
	return { api, actions, files, path, draft };
}

describe("pending diagram edits", () => {
	it.each([
		"navigate",
		"switch tab",
		"close tab",
		"rename",
	] as const)("saves the editor's latest draft before %s", async (action) => {
		const { actions, files, path, draft } = await setup();
		expect(actions.viewerStore.get().content).toBe("");
		if (action === "navigate") await actions.loadPath("/workspace/note.md");
		if (action === "switch tab")
			await actions.openTabForPath("/workspace/note.md");
		if (action === "close tab") await actions.closeActiveTab();
		if (action === "rename") await actions.renameMarkdownFile(path, "renamed");
		expect(
			files.get(action === "rename" ? "/workspace/renamed.tldr" : path),
		).toBe(draft);
	});

	it("keeps the diagram open when writing its pending draft fails", async () => {
		const { api, actions, path, draft } = await setup();
		api.writeFileText.mockRejectedValue(new Error("disk full"));
		await actions.closeActiveTab();
		expect(actions.viewerStore.get().currentPath).toBe(path);
		expect(actions.viewerStore.get().content).toBe(draft);
		expect(actions.tabsStore.get().order).toHaveLength(1);
	});

	it("keeps the diagram open when its pending draft conflicts with disk", async () => {
		const { actions, files, path, draft } = await setup();
		files.set(path, "external changes");
		await actions.loadPath("/workspace/note.md");
		expect(actions.viewerStore.get().currentPath).toBe(path);
		expect(actions.viewerStore.get().content).toBe(draft);
		expect(actions.viewerStore.get().externalChange.kind).toBe("conflict");
		expect(files.get(path)).toBe("external changes");
	});
});
