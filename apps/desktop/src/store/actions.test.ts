import { beforeEach, describe, expect, it, vi } from "vitest";

type MockDesktopApi = {
	readFileText: ReturnType<typeof vi.fn>;
	writeFileText: ReturnType<typeof vi.fn>;
	listDirectory: ReturnType<typeof vi.fn>;
	readWorkspaceConfig: ReturnType<typeof vi.fn>;
	writeWorkspaceConfig: ReturnType<typeof vi.fn>;
	createFolder: ReturnType<typeof vi.fn>;
	renameFile: ReturnType<typeof vi.fn>;
	deleteFile: ReturnType<typeof vi.fn>;
	pathExists: ReturnType<typeof vi.fn>;
};

function createDesktopApi(): MockDesktopApi {
	return {
		readFileText: vi.fn(async () => "before"),
		writeFileText: vi.fn(async () => {}),
		listDirectory: vi.fn(async () => ({ files: [], folders: [] })),
		readWorkspaceConfig: vi.fn(async () => ({ version: 1, pinnedNotes: [] })),
		writeWorkspaceConfig: vi.fn(async () => {}),
		createFolder: vi.fn(async () => {}),
		renameFile: vi.fn(async () => {}),
		deleteFile: vi.fn(async () => {}),
		pathExists: vi.fn(async () => false),
	};
}

/**
 * Actions capture window.desktopApi at import time, so each test stubs globals
 * before importing the store modules.
 */
async function loadStoreActions(api: MockDesktopApi) {
	vi.resetModules();
	vi.stubGlobal("localStorage", {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
	});
	vi.stubGlobal("window", {
		desktopApi: api,
		setTimeout,
		clearTimeout,
	});

	const actions = await import("./actions");
	const history = await import("./history");
	const state = await import("./state");
	return { ...actions, ...history, ...state };
}

describe("desktop savePathContent", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("hydrates the default chat command and persists edits", async () => {
		const api = createDesktopApi();
		const { chatCommandStore, setChatCommand } = await loadStoreActions(api);
		const { STORAGE_KEY } = await import("./persistence");
		const { DEFAULT_CHAT_COMMAND } = await import("./settings");

		expect(chatCommandStore.get()).toBe(DEFAULT_CHAT_COMMAND);

		setChatCommand("codex exec");

		expect(chatCommandStore.get()).toBe("codex exec");
		expect(localStorage.setItem).toHaveBeenLastCalledWith(
			STORAGE_KEY,
			expect.stringContaining('"chatCommand":"codex exec"'),
		);
	});

	it("requests chat with the default command when the setting is blank", async () => {
		const api = createDesktopApi();
		const {
			appStore,
			requestChatAboutNote,
			setChatCommand,
			pendingTerminalCommandStore,
		} = await loadStoreActions(api);
		const { DEFAULT_CHAT_COMMAND } = await import("./settings");

		setChatCommand("   ");
		requestChatAboutNote();

		expect(appStore.get().ui.isTerminalOpen).toBe(true);
		expect(pendingTerminalCommandStore.get()).toBe(DEFAULT_CHAT_COMMAND);
	});

	it("preserves newer editor content when an older save finishes", async () => {
		const api = createDesktopApi();
		let finishWrite: () => void = () => {};
		// Keep the disk write pending so we can simulate more typing before the
		// older save resolves back into the store.
		api.writeFileText.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishWrite = resolve;
				}),
		);
		const { appStore, savePathContent, updateEditorContent, viewerStore } =
			await loadStoreActions(api);
		const path = "/workspace/note.md";

		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				currentPath: path,
				lastOpenedPath: path,
				content: "draft 1",
				diskContent: "before",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		const save = savePathContent(path, "draft 1");
		await Promise.resolve();
		expect(api.writeFileText).toHaveBeenCalledWith(path, "draft 1");

		updateEditorContent(path, "draft 2");
		finishWrite();
		await save;

		expect(viewerStore.get().content).toBe("draft 2");
		expect(viewerStore.get().diskContent).toBe("draft 1");
		expect(viewerStore.get().externalChange).toEqual({ kind: "none" });
	});

	it("does not treat an in-flight self-save watcher event as an external conflict", async () => {
		const api = createDesktopApi();
		let finishWrite: () => void = () => {};
		api.writeFileText.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishWrite = resolve;
				}),
		);
		const {
			appStore,
			handleExternalFileChange,
			savePathContent,
			updateEditorContent,
			viewerStore,
		} = await loadStoreActions(api);
		const path = "/workspace/note.md";

		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				currentPath: path,
				lastOpenedPath: path,
				content: "draft 1",
				diskContent: "before",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		const save = savePathContent(path, "draft 1");
		await Promise.resolve();
		expect(api.writeFileText).toHaveBeenCalledWith(path, "draft 1");

		updateEditorContent(path, "draft 2");
		handleExternalFileChange(path, "draft 1");

		expect(viewerStore.get().content).toBe("draft 2");
		expect(viewerStore.get().diskContent).toBe("draft 1");
		expect(viewerStore.get().externalChange).toEqual({ kind: "none" });

		finishWrite();
		await save;

		expect(viewerStore.get().content).toBe("draft 2");
		expect(viewerStore.get().diskContent).toBe("draft 1");
		expect(viewerStore.get().externalChange).toEqual({ kind: "none" });
	});

	it("uses latest editor content when classifying disk changes", async () => {
		const api = createDesktopApi();
		// The file now matches what the user just typed, even though the save
		// that is finishing still has the older text.
		api.readFileText.mockResolvedValue("draft 2");
		const { appStore, savePathContent, updateEditorContent, viewerStore } =
			await loadStoreActions(api);
		const path = "/workspace/note.md";

		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				currentPath: path,
				lastOpenedPath: path,
				content: "draft 1",
				diskContent: "before",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));
		updateEditorContent(path, "draft 2");

		await savePathContent(path, "draft 1");

		expect(api.writeFileText).not.toHaveBeenCalled();
		expect(viewerStore.get().content).toBe("draft 2");
		expect(viewerStore.get().diskContent).toBe("draft 2");
		expect(viewerStore.get().externalChange).toEqual({ kind: "none" });
	});

	it("switches view mode without changing editor content", async () => {
		const api = createDesktopApi();
		const { appStore, setViewerMode, viewerStore } =
			await loadStoreActions(api);
		const path = "/workspace/note.md";

		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				currentPath: path,
				lastOpenedPath: path,
				content: "draft",
				diskContent: "before",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		setViewerMode("source");

		expect(viewerStore.get().viewMode).toBe("source");
		expect(viewerStore.get().content).toBe("draft");
	});

	it("resets source mode when opening another file", async () => {
		const api = createDesktopApi();
		api.readFileText.mockResolvedValue("next file");
		const { appStore, loadPath, setViewerMode, viewerStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				currentPath: "/workspace/old.md",
				lastOpenedPath: "/workspace/old.md",
				content: "old file",
				diskContent: "old file",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));
		setViewerMode("source");

		await loadPath("/workspace/next.md");

		expect(viewerStore.get().currentPath).toBe("/workspace/next.md");
		expect(viewerStore.get().content).toBe("next file");
		expect(viewerStore.get().viewMode).toBe("rich");
	});
});

describe("desktop renameMarkdownFile", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("reopens the active file from its renamed path", async () => {
		const api = createDesktopApi();
		api.readFileText.mockResolvedValue("embed content");
		api.listDirectory.mockResolvedValue({
			files: [{ path: "/workspace/renamed.md", modified_at: 1 }],
			folders: [],
		});
		const { appStore, renameMarkdownFile, viewerStore, workspaceStore } =
			await loadStoreActions(api);
		const path = "/workspace/original.md";

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path, modified_at: 1 }],
				lastOpenedPaths: { "/workspace": path },
			},
			document: {
				...current.document,
				currentPath: path,
				lastOpenedPath: path,
				content: "embed content",
				diskContent: "embed content",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		await renameMarkdownFile(path, "renamed");

		expect(api.renameFile).toHaveBeenCalledWith(path, "/workspace/renamed.md");
		expect(api.readFileText).toHaveBeenLastCalledWith("/workspace/renamed.md");
		expect(viewerStore.get().currentPath).toBe("/workspace/renamed.md");
		expect(viewerStore.get().content).toBe("embed content");
		expect(workspaceStore.get().lastOpenedPaths["/workspace"]).toBe(
			"/workspace/renamed.md",
		);
	});

	it("updates pinned note paths in workspace config", async () => {
		const api = createDesktopApi();
		const { appStore, renameMarkdownFile, workspaceStore } =
			await loadStoreActions(api);
		const path = "/workspace/original.md";

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path, modified_at: 1 }],
				pinnedNotes: [path],
			},
		}));

		await renameMarkdownFile(path, "renamed");

		expect(workspaceStore.get().pinnedNotes).toEqual(["/workspace/renamed.md"]);
		expect(api.writeWorkspaceConfig).toHaveBeenCalledWith("/workspace", {
			version: 1,
			pinnedNotes: ["renamed.md"],
		});
	});

	it("renames to nested paths relative to the current folder", async () => {
		const api = createDesktopApi();
		api.listDirectory.mockResolvedValue({
			files: [{ path: "/workspace/notes/archive/q1-plan.md", modified_at: 1 }],
			folders: [],
		});
		const { appStore, renameMarkdownFile, viewerStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path: "/workspace/notes/plan.md", modified_at: 1 }],
			},
			document: {
				...current.document,
				currentPath: "/workspace/notes/plan.md",
				lastOpenedPath: "/workspace/notes/plan.md",
				content: "plan",
				diskContent: "plan",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		await renameMarkdownFile("/workspace/notes/plan.md", "archive/q1-plan");

		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/notes/plan.md",
			"/workspace/notes/archive/q1-plan.md",
		);
		expect(viewerStore.get().currentPath).toBe(
			"/workspace/notes/archive/q1-plan.md",
		);
	});

	it("renames to nested paths in Windows workspaces", async () => {
		const api = createDesktopApi();
		api.listDirectory.mockResolvedValue({
			files: [
				{ path: "C:/workspace/notes/archive/q1-plan.md", modified_at: 1 },
			],
			folders: [],
		});
		const { appStore, renameMarkdownFile, viewerStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "C:\\workspace",
				files: [{ path: "C:\\workspace\\notes\\plan.md", modified_at: 1 }],
			},
			document: {
				...current.document,
				currentPath: "C:\\workspace\\notes\\plan.md",
				lastOpenedPath: "C:\\workspace\\notes\\plan.md",
				content: "plan",
				diskContent: "plan",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		await renameMarkdownFile(
			"C:\\workspace\\notes\\plan.md",
			"archive/q1-plan",
		);

		expect(api.renameFile).toHaveBeenCalledWith(
			"C:\\workspace\\notes\\plan.md",
			"C:/workspace/notes/archive/q1-plan.md",
		);
		expect(viewerStore.get().currentPath).toBe(
			"C:/workspace/notes/archive/q1-plan.md",
		);
	});

	it("does not rename a missing asset folder", async () => {
		const api = createDesktopApi();
		const { appStore, renameMarkdownFile } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path: "/workspace/notes/draft.md", modified_at: 1 }],
			},
		}));

		await renameMarkdownFile("/workspace/notes/draft.md", "archive/draft");

		expect(api.pathExists).toHaveBeenCalledWith(
			"/workspace/notes/draft.assets",
		);
		expect(api.renameFile).toHaveBeenCalledTimes(1);
		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/notes/draft.md",
			"/workspace/notes/archive/draft.md",
		);
		expect(api.renameFile).not.toHaveBeenCalledWith(
			"/workspace/notes/draft.assets",
			"/workspace/notes/archive/draft.assets",
		);
	});

	it("rejects rename paths outside the workspace", async () => {
		const api = createDesktopApi();
		const { appStore, renameMarkdownFile } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path: "/workspace/original.md", modified_at: 1 }],
			},
		}));

		await renameMarkdownFile("/workspace/original.md", "../outside.md");

		expect(api.renameFile).not.toHaveBeenCalled();
	});

	it("updates backlinks to the renamed file", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(async (path: string) => {
			if (path === "/workspace/notes/source.md") {
				return [
					"[Target](../target.md)",
					'[Titled](../target.md "caption")',
					"![Image](../target.assets/image.png)",
					"[[target.md|Target]]",
				].join("\n");
			}
			return "target";
		});
		const { appStore, renameMarkdownFile } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: "/workspace/notes/source.md", modified_at: 1 },
					{ path: "/workspace/target.md", modified_at: 1 },
				],
			},
		}));

		await renameMarkdownFile("/workspace/target.md", "renamed");

		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/notes/source.md",
			[
				"[Target](../renamed.md)",
				'[Titled](../renamed.md "caption")',
				"![Image](../renamed.assets/image.png)",
				"[[renamed.md|Target]]",
			].join("\n"),
		);
	});

	it("renames the associated asset folder and updates refs", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(async (path: string) => {
			if (path === "/workspace/learning.md") {
				return "![Recall](effective-learning-techniques.assets/recall.jpg)";
			}
			return "";
		});
		const { appStore, renameMarkdownFile } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{
						path: "/workspace/effective-learning-techniques.md",
						modified_at: 1,
					},
				],
			},
		}));

		await renameMarkdownFile(
			"/workspace/effective-learning-techniques.md",
			"learning",
		);

		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/effective-learning-techniques.assets",
			"/workspace/learning.assets",
		);
		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/learning.md",
			"![Recall](learning.assets/recall.jpg)",
		);
	});

	it("preserves unsaved edits when rewriting backlinks in the open file", async () => {
		const api = createDesktopApi();
		api.readFileText.mockImplementation(async (path: string) => {
			if (path === "/workspace/source.md") return "[Target](target.md)";
			return "target";
		});
		const { appStore, renameMarkdownFile, viewerStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: "/workspace/source.md", modified_at: 1 },
					{ path: "/workspace/target.md", modified_at: 1 },
				],
			},
			document: {
				...current.document,
				currentPath: "/workspace/source.md",
				lastOpenedPath: "/workspace/source.md",
				content: "[Target](target.md)\nunsaved edit",
				diskContent: "[Target](target.md)",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		await renameMarkdownFile("/workspace/target.md", "renamed");

		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/source.md",
			"[Target](renamed.md)\nunsaved edit",
		);
		expect(viewerStore.get().content).toBe(
			"[Target](renamed.md)\nunsaved edit",
		);
	});
});

describe("desktop folder actions", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("creates a unique folder and adds it to the sidebar snapshot", async () => {
		const api = createDesktopApi();
		api.listDirectory.mockResolvedValue({
			files: [],
			folders: [{ path: "/workspace/new-folder-2", modified_at: 2 }],
		});
		const { appStore, createFolderInFolder, workspaceStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				folders: [{ path: "/workspace/new-folder", modified_at: 1 }],
			},
		}));

		const path = await createFolderInFolder("/workspace");

		expect(path).toBe("/workspace/new-folder-2");
		expect(api.createFolder).toHaveBeenCalledWith("/workspace/new-folder-2");
		expect(workspaceStore.get().folders).toEqual([
			{ path: "/workspace/new-folder-2", modified_at: 2 },
		]);
	});

	it("renames folders and rewrites contained workspace paths", async () => {
		const api = createDesktopApi();
		api.listDirectory.mockResolvedValue({
			files: [{ path: "/workspace/archive/plan.md", modified_at: 2 }],
			folders: [{ path: "/workspace/archive", modified_at: 2 }],
		});
		const { appStore, renameFolder, viewerStore, workspaceStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path: "/workspace/drafts/plan.md", modified_at: 1 }],
				folders: [{ path: "/workspace/drafts", modified_at: 1 }],
				pinnedNotes: ["/workspace/drafts/plan.md"],
				lastOpenedPaths: { "/workspace": "/workspace/drafts/plan.md" },
			},
			document: {
				...current.document,
				currentPath: "/workspace/drafts/plan.md",
				lastOpenedPath: "/workspace/drafts/plan.md",
				content: "[Self](plan.md)",
				diskContent: "[Self](plan.md)",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		await renameFolder("/workspace/drafts", "archive");

		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/drafts",
			"/workspace/archive",
		);
		expect(viewerStore.get().currentPath).toBe("/workspace/archive/plan.md");
		expect(workspaceStore.get().pinnedNotes).toEqual([
			"/workspace/archive/plan.md",
		]);
		expect(api.writeWorkspaceConfig).toHaveBeenCalledWith("/workspace", {
			version: 1,
			pinnedNotes: ["archive/plan.md"],
		});
	});

	it("renames compacted nested folders to the requested display path", async () => {
		const api = createDesktopApi();
		api.listDirectory.mockResolvedValue({
			files: [{ path: "/workspace/archive/plan.md", modified_at: 2 }],
			folders: [{ path: "/workspace/archive", modified_at: 2 }],
		});
		const { appStore, renameFolder } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path: "/workspace/drafts/current/plan.md", modified_at: 1 }],
				folders: [
					{ path: "/workspace/drafts", modified_at: 1 },
					{ path: "/workspace/drafts/current", modified_at: 1 },
				],
			},
		}));

		await renameFolder(
			"/workspace/drafts/current",
			"archive",
			"/workspace/archive",
		);

		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/drafts/current",
			"/workspace/archive",
		);
		expect(api.renameFile).not.toHaveBeenCalledWith(
			"/workspace/drafts/current",
			"/workspace/drafts/current/archive",
		);
		expect(api.deleteFile).toHaveBeenCalledWith("/workspace/drafts");
	});

	it("deletes a freshly created folder when inline naming is canceled", async () => {
		const api = createDesktopApi();
		const { appStore, createFolderInFolder, deleteFolder, workspaceStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
			},
		}));

		const path = await createFolderInFolder("/workspace");
		if (!path) throw new Error("Expected created folder path");
		await deleteFolder(path);

		expect(api.createFolder).toHaveBeenCalledWith("/workspace/new-folder");
		expect(api.deleteFile).toHaveBeenCalledWith("/workspace/new-folder", {
			recursive: true,
		});
		expect(workspaceStore.get().folders).toEqual([]);
	});
});

describe("desktop moveSidebarItem", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("moves a file to a folder and updates opened state", async () => {
		const api = createDesktopApi();
		api.listDirectory.mockResolvedValue({
			files: [{ path: "/workspace/archive/note.md", modified_at: 1 }],
			folders: [],
		});
		const { appStore, moveSidebarItem, viewerStore, workspaceStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: "/workspace/note.md", modified_at: 1 },
					{ path: "/workspace/archive/existing.md", modified_at: 1 },
				],
				pinnedNotes: ["/workspace/note.md"],
				lastOpenedPaths: { "/workspace": "/workspace/note.md" },
			},
			document: {
				...current.document,
				currentPath: "/workspace/note.md",
				lastOpenedPath: "/workspace/note.md",
				content: "draft",
				diskContent: "draft",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		await moveSidebarItem(
			{ kind: "file", path: "/workspace/note.md" },
			"/workspace/archive",
		);

		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/note.md",
			"/workspace/archive/note.md",
		);
		expect(viewerStore.get().currentPath).toBe("/workspace/archive/note.md");
		expect(workspaceStore.get().pinnedNotes).toEqual([
			"/workspace/archive/note.md",
		]);
		expect(api.writeWorkspaceConfig).toHaveBeenCalledWith("/workspace", {
			version: 1,
			pinnedNotes: ["archive/note.md"],
		});
	});

	it("updates relative refs when moving a file", async () => {
		const api = createDesktopApi();
		api.readFileText.mockResolvedValue(
			[
				"![Recall](effective-learning-techniques.assets/recall-diagram.jpg)",
				'<iframe src="./file-index.html"></iframe>',
				"[External](https://example.com)",
			].join("\n"),
		);
		const { appStore, moveSidebarItem } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: "/workspace/samples/source.md", modified_at: 1 },
					{
						path: "/workspace/deeply/nested/folder/example.md",
						modified_at: 1,
					},
				],
			},
		}));

		await moveSidebarItem(
			{ kind: "file", path: "/workspace/samples/source.md" },
			"/workspace/deeply/nested/folder",
		);

		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/deeply/nested/folder/source.md",
			[
				"![Recall](../../../samples/effective-learning-techniques.assets/recall-diagram.jpg)",
				'<iframe src="../../../samples/file-index.html"></iframe>',
				"[External](https://example.com)",
			].join("\n"),
		);
	});

	it("moves the associated asset folder with a moved file", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockResolvedValue(
			"![Recall](source.assets/recall-diagram.jpg)",
		);
		const { appStore, moveSidebarItem } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: "/workspace/samples/source.md", modified_at: 1 },
					{
						path: "/workspace/deeply/nested/folder/example.md",
						modified_at: 1,
					},
				],
			},
		}));

		await moveSidebarItem(
			{ kind: "file", path: "/workspace/samples/source.md" },
			"/workspace/deeply/nested/folder",
		);

		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/samples/source.assets",
			"/workspace/deeply/nested/folder/source.assets",
		);
		expect(api.writeFileText).not.toHaveBeenCalled();
	});

	it("suffixes folder conflicts and rewrites descendants", async () => {
		const api = createDesktopApi();
		api.readFileText.mockImplementation(async (path: string) => {
			if (path === "/workspace/archive/client 1/brief.md") {
				return "[Outside](../outside.md)";
			}
			return "outside";
		});
		const { appStore, moveSidebarItem, viewerStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: "/workspace/archive/client/existing.md", modified_at: 1 },
					{ path: "/workspace/client/brief.md", modified_at: 1 },
					{ path: "/workspace/outside.md", modified_at: 1 },
				],
			},
			document: {
				...current.document,
				currentPath: "/workspace/client/brief.md",
				lastOpenedPath: "/workspace/client/brief.md",
				content: "[Outside](../outside.md)",
				diskContent: "[Outside](../outside.md)",
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			},
		}));

		await moveSidebarItem(
			{ kind: "folder", folderId: "client/" },
			"/workspace/archive",
		);

		expect(api.renameFile).toHaveBeenCalledWith(
			"/workspace/client",
			"/workspace/archive/client 1",
		);
		expect(viewerStore.get().currentPath).toBe(
			"/workspace/archive/client 1/brief.md",
		);
		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/archive/client 1/brief.md",
			"[Outside](../../outside.md)",
		);
	});

	it("rewrites folder descendant refs and external backlinks", async () => {
		const api = createDesktopApi();
		api.readFileText.mockImplementation(async (path: string) => {
			if (path === "/workspace/archive/project/notes/a.md") {
				return [
					"[Outside](../../outside.md)",
					"[Peer](b.md)",
					'<img src="../../shared/image.png">',
				].join("\n");
			}
			if (path === "/workspace/archive/project/notes/b.md") {
				return "[Outside](../../outside.md)";
			}
			if (path === "/workspace/outside.md") {
				return ["[A](project/notes/a.md)", "[[project/notes/b.md|B]]"].join(
					"\n",
				);
			}
			return "";
		});
		const { appStore, moveSidebarItem } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: "/workspace/project/notes/a.md", modified_at: 1 },
					{ path: "/workspace/project/notes/b.md", modified_at: 1 },
					{ path: "/workspace/outside.md", modified_at: 1 },
				],
			},
		}));

		await moveSidebarItem(
			{ kind: "folder", folderId: "project/" },
			"/workspace/archive",
		);

		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/archive/project/notes/a.md",
			[
				"[Outside](../../../outside.md)",
				"[Peer](b.md)",
				'<img src="../../../shared/image.png">',
			].join("\n"),
		);
		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/archive/project/notes/b.md",
			"[Outside](../../../outside.md)",
		);
		expect(api.writeFileText).toHaveBeenCalledWith(
			"/workspace/outside.md",
			[
				"[A](archive/project/notes/a.md)",
				"[[archive/project/notes/b.md|B]]",
			].join("\n"),
		);
	});
});

describe("desktop loadPath", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("tracks back and forward history through successful opens", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const {
			canGoBack,
			canGoForward,
			goBack,
			goForward,
			loadPath,
			viewerStore,
		} = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		await loadPath("/workspace/c.md");

		expect(canGoBack()).toBe(true);
		expect(canGoForward()).toBe(false);

		await goBack();

		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
		expect(viewerStore.get().content).toBe("content:/workspace/b.md");
		expect(canGoBack()).toBe(true);
		expect(canGoForward()).toBe(true);

		await goForward();

		expect(viewerStore.get().currentPath).toBe("/workspace/c.md");
		expect(canGoForward()).toBe(false);
	});

	it("keeps history availability stable while blocking concurrent navigation", async () => {
		const api = createDesktopApi();
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		let resolvePathExists: ((exists: boolean) => void) | undefined;
		api.pathExists.mockImplementation(
			() =>
				new Promise<boolean>((resolve) => {
					resolvePathExists = resolve;
				}),
		);
		const {
			canGoBack,
			canGoForward,
			goBack,
			historyStore,
			loadPath,
			viewerStore,
		} = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		await loadPath("/workspace/c.md");

		const firstNavigation = goBack();
		await vi.waitFor(() => expect(historyStore.get().isNavigating).toBe(true));
		expect(canGoBack()).toBe(true);
		expect(canGoForward()).toBe(false);
		await goBack();
		expect(api.pathExists).toHaveBeenCalledTimes(1);

		resolvePathExists?.(true);
		await firstNavigation;
		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
	});

	it("stays on the current file when opening a missing file fails", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(async (path: string) => {
			if (path === "/workspace/missing.md") {
				throw new Error("ENOENT: no such file or directory");
			}
			return `content:${path}`;
		});
		const { canGoBack, canGoForward, goBack, loadPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		await loadPath("/workspace/missing.md");

		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
		expect(viewerStore.get().content).toBe("content:/workspace/b.md");
		expect(viewerStore.get().status).toBe("ready");
		expect(canGoBack()).toBe(true);
		expect(canGoForward()).toBe(false);

		await goBack();

		expect(viewerStore.get().currentPath).toBe("/workspace/a.md");
	});

	it("truncates forward history when a new file opens after going back", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { canGoForward, goBack, loadPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		await loadPath("/workspace/c.md");
		await goBack();
		await loadPath("/workspace/d.md");

		expect(viewerStore.get().currentPath).toBe("/workspace/d.md");
		expect(canGoForward()).toBe(false);
	});

	it("keeps navigation history separate per workspace", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, canGoBack, loadPath } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: { ...current.workspace, workspacePath: "/workspace-a" },
		}));
		await loadPath("/workspace-a/a.md");
		await loadPath("/workspace-a/b.md");
		expect(canGoBack()).toBe(true);

		appStore.set((current) => ({
			...current,
			workspace: { ...current.workspace, workspacePath: "/workspace-b" },
		}));

		expect(canGoBack()).toBe(false);
	});

	it("saves dirty content before navigating history", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { goBack, loadPath, updateEditorContent } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		updateEditorContent("/workspace/b.md", "dirty");

		await goBack();

		expect(api.writeFileText).toHaveBeenCalledWith("/workspace/b.md", "dirty");
	});

	it("blocks history navigation while the current file has a disk conflict", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { appStore, goBack, loadPath, viewerStore } =
			await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		appStore.set((current) => ({
			...current,
			document: {
				...current.document,
				externalChange: { kind: "conflict", diskContent: "disk" },
			},
		}));

		await goBack();

		expect(viewerStore.get().currentPath).toBe("/workspace/b.md");
	});

	it("silently clears a missing restore path without toasting", async () => {
		const api = createDesktopApi();
		const missingPath = "/workspace/missing.md";
		api.readFileText.mockRejectedValue(
			new Error(`ENOENT: no such file or directory, open '${missingPath}'`),
		);
		const toastError = vi.fn();
		vi.doMock("sonner", () => ({ toast: { error: toastError } }));
		const { appStore, loadPath, viewerStore } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				lastOpenedPaths: { "/workspace": missingPath },
			},
			document: {
				...current.document,
				lastOpenedPath: missingPath,
			},
		}));

		await loadPath(missingPath, { missing: "silent" });

		expect(viewerStore.get().currentPath).toBeNull();
		expect(viewerStore.get().status).toBe("idle");
		expect(viewerStore.get().lastOpenedPath).toBeNull();
		expect(appStore.get().workspace.lastOpenedPaths).toEqual({});
		expect(toastError).not.toHaveBeenCalled();
	});

	it("does not push history when reloading a renamed current file", async () => {
		const api = createDesktopApi();
		api.pathExists.mockResolvedValue(true);
		api.readFileText.mockImplementation(
			async (path: string) => `content:${path}`,
		);
		const { canGoBack, loadPath, viewerStore } = await loadStoreActions(api);

		await loadPath("/workspace/a.md");
		await loadPath("/workspace/b.md");
		await loadPath("/workspace/b-renamed.md", { history: "none" });

		expect(viewerStore.get().currentPath).toBe("/workspace/b-renamed.md");
		expect(canGoBack()).toBe(true);
	});

	it("refreshes the sidebar when a selected file no longer exists", async () => {
		const api = createDesktopApi();
		const missingPath = "/workspace/missing.md";
		const remainingPath = "/workspace/remaining.md";
		api.readFileText.mockRejectedValue(
			new Error(`ENOENT: no such file or directory, open '${missingPath}'`),
		);
		api.listDirectory.mockResolvedValue({
			files: [{ path: remainingPath, modified_at: 2 }],
			folders: [],
		});
		const { appStore, loadPath, workspaceStore } = await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [
					{ path: missingPath, modified_at: 1 },
					{ path: remainingPath, modified_at: 2 },
				],
			},
		}));

		await loadPath(missingPath);

		await vi.waitFor(() => {
			expect(workspaceStore.get().files).toEqual([
				{ path: remainingPath, modified_at: 2 },
			]);
		});
	});

	it("debounces repeated missing-file sidebar refreshes", async () => {
		vi.useFakeTimers();
		try {
			const api = createDesktopApi();
			api.readFileText.mockRejectedValue(
				new Error("ENOENT: no such file or directory"),
			);
			api.listDirectory.mockResolvedValue({ files: [], folders: [] });
			const { appStore, loadPath } = await loadStoreActions(api);

			appStore.set((current) => ({
				...current,
				workspace: {
					...current.workspace,
					workspacePath: "/workspace",
					files: [
						{ path: "/workspace/a.md", modified_at: 1 },
						{ path: "/workspace/b.md", modified_at: 1 },
					],
				},
			}));

			await loadPath("/workspace/a.md");
			await loadPath("/workspace/b.md");

			expect(api.listDirectory).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(250);

			expect(api.listDirectory).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("desktop pinned notes", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("loads missing workspace config as an empty pin set", async () => {
		const api = createDesktopApi();
		api.readWorkspaceConfig.mockResolvedValue({ version: 1, pinnedNotes: [] });
		const { openWorkspace, workspaceStore } = await loadStoreActions(api);

		await openWorkspace("/workspace");

		expect(api.readWorkspaceConfig).toHaveBeenCalledWith("/workspace");
		expect(workspaceStore.get().pinnedNotes).toEqual([]);
	});

	it("loads persisted pins as absolute workspace paths", async () => {
		const api = createDesktopApi();
		api.readWorkspaceConfig.mockResolvedValue({
			version: 1,
			pinnedNotes: ["notes/a.md"],
		});
		const { openWorkspace, workspaceStore } = await loadStoreActions(api);

		await openWorkspace("/workspace");

		expect(workspaceStore.get().pinnedNotes).toEqual(["/workspace/notes/a.md"]);
	});

	it("pins and unpins notes through workspace config", async () => {
		const api = createDesktopApi();
		const { appStore, togglePinnedNote, workspaceStore } =
			await loadStoreActions(api);

		appStore.set((current) => ({
			...current,
			workspace: {
				...current.workspace,
				workspacePath: "/workspace",
				files: [{ path: "/workspace/note.md", modified_at: 1 }],
			},
		}));

		await togglePinnedNote("/workspace/note.md");
		expect(workspaceStore.get().pinnedNotes).toEqual(["/workspace/note.md"]);
		expect(api.writeWorkspaceConfig).toHaveBeenLastCalledWith("/workspace", {
			version: 1,
			pinnedNotes: ["note.md"],
		});

		await togglePinnedNote("/workspace/note.md");
		expect(workspaceStore.get().pinnedNotes).toEqual([]);
		expect(api.writeWorkspaceConfig).toHaveBeenLastCalledWith("/workspace", {
			version: 1,
			pinnedNotes: [],
		});
	});
});
