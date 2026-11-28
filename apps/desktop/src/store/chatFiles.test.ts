import { afterEach, expect, it, vi } from "vitest";
import { createDesktopApi, loadStoreActions } from "./testUtils";

afterEach(() => vi.unstubAllGlobals());

async function setup() {
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 0;
	});
	const api = createDesktopApi();
	let disk = "Disk version";
	api.readFileText.mockImplementation(async () => disk);
	api.writeFileText.mockImplementation(async (_path, text) => {
		disk = text;
	});
	await loadStoreActions(api);
	const { appStore, cleanFileState, emptyDoc, viewerStore } = await import(
		"./state"
	);
	appStore.set((state) => ({
		...state,
		workspace: { ...state.workspace, workspacePath: "/workspace" },
		document: {
			...emptyDoc(),
			currentPath: "/workspace/note.md",
			...cleanFileState("Disk version"),
			content: "Unsaved version",
		},
	}));
	const { handleChatFileRequest } = await import("./chatFiles");
	const request = {
		requestId: "r",
		callId: "c",
		workspacePath: "/workspace",
		path: "/workspace/note.md",
		operation: "write" as const,
		before: "Unsaved version",
		after: "Agent edit",
	};
	return {
		api,
		appStore,
		viewerStore,
		handleChatFileRequest,
		request,
		disk: () => disk,
	};
}

it("reads the live buffer and saves agent edits through the real editor save queue", async () => {
	const s = await setup();
	expect(
		await s.handleChatFileRequest(
			{ ...s.request, operation: "read" },
			() => true,
		),
	).toMatchObject({
		open: true,
		text: "Unsaved version",
		diskContent: "Disk version",
	});
	expect(await s.handleChatFileRequest(s.request, () => true)).toMatchObject({
		open: true,
	});
	expect(s.disk()).toBe("Agent edit");
	expect(s.viewerStore.get()).toMatchObject({
		content: "Agent edit",
		diskContent: "Agent edit",
		undoableUpdate: expect.any(String),
	});
	const firstUpdate = s.viewerStore.get().undoableUpdate;
	await s.handleChatFileRequest(
		{ ...s.request, before: "Agent edit", after: "Second edit" },
		() => true,
	);
	expect(s.viewerStore.get().undoableUpdate).not.toBe(firstUpdate);
});

it("rejects changed buffers and workspace changes without writing", async () => {
	const s = await setup();
	s.viewerStore.set((doc) => ({ ...doc, content: "New human edit" }));
	expect(await s.handleChatFileRequest(s.request, () => true)).toMatchObject({
		error: expect.stringContaining("Editor changed"),
	});
	s.appStore.set((state) => ({
		...state,
		workspace: { ...state.workspace, workspacePath: "/other" },
	}));
	expect(
		await s.handleChatFileRequest(
			{ ...s.request, operation: "read" },
			() => true,
		),
	).toMatchObject({ error: expect.stringContaining("workspace changed") });
	expect(s.api.writeFileText).not.toHaveBeenCalled();
	expect(s.viewerStore.get().content).toBe("New human edit");
});

it("does not change the buffer or disk when stopped during save preflight", async () => {
	const s = await setup();
	let active = true;
	s.api.readFileText.mockImplementation(async () => {
		active = false;
		return "Disk version";
	});
	expect(await s.handleChatFileRequest(s.request, () => active)).toMatchObject({
		error: expect.stringContaining("stopped"),
	});
	expect(s.api.writeFileText).not.toHaveBeenCalled();
	expect(s.viewerStore.get().content).toBe("Unsaved version");
});

it("stages tool deletions with the normal Undo flow and leaves a different open note intact", async () => {
	const s = await setup();
	s.viewerStore.set((doc) => ({
		...doc,
		currentPath: "/workspace/other.md",
		content: "Other note",
		diskContent: "Other note",
	}));
	expect(
		await s.handleChatFileRequest(
			{ ...s.request, operation: "delete", before: "Disk version" },
			() => true,
		),
	).toMatchObject({ open: true });
	expect(s.api.stageDelete).toHaveBeenCalledWith("/workspace", [
		"/workspace/note.md",
	]);
	expect(s.viewerStore.get().content).toBe("Other note");
	const { undoDelete } = await import("./actions");
	expect(await undoDelete()).toBe(true);
	expect(s.api.restoreDelete).toHaveBeenCalledWith("delete-token");
});

it("does not stage a deletion after the file changes or the request is stopped during its final check", async () => {
	const s = await setup();
	s.viewerStore.set((doc) => ({
		...doc,
		currentPath: "/workspace/other.md",
		content: "Other note",
		diskContent: "Other note",
	}));
	expect(
		await s.handleChatFileRequest(
			{ ...s.request, operation: "delete", before: "Stale version" },
			() => true,
		),
	).toMatchObject({ error: expect.stringContaining("changed") });
	let active = true;
	s.api.readFileText.mockImplementation(async () => {
		active = false;
		return "Disk version";
	});
	expect(
		await s.handleChatFileRequest(
			{ ...s.request, operation: "delete", before: "Disk version" },
			() => active,
		),
	).toMatchObject({ error: expect.stringContaining("stopped") });
	expect(s.api.stageDelete).not.toHaveBeenCalled();
});

it("returns to the new-tab page without losing the chat when its own file is deleted", async () => {
	const s = await setup();
	const id = crypto.randomUUID();
	const chat = {
		messages: [
			{
				id: "u",
				role: "user" as const,
				text: "Delete this file",
				status: "complete" as const,
			},
		],
		draft: "Follow-up",
		model: "model",
	};
	s.appStore.set((state) => ({
		...state,
		tabs: {
			...state.tabs,
			activeTabId: id,
			order: [id],
			byId: { [id]: { path: s.request.path, chat } },
		},
	}));
	expect(
		await s.handleChatFileRequest(
			{ ...s.request, operation: "delete" },
			() => true,
			id,
		),
	).toMatchObject({ open: true });
	const tab = s.appStore.get().tabs.byId[id];
	expect(tab.path).toMatch(/^hubble:\/\/new-tab\//);
	expect(tab.chat).toEqual(chat);
	expect(s.viewerStore.get()).toMatchObject({
		currentPath: tab.path,
		content: "",
		status: "ready",
	});
	expect(s.api.stageDelete).toHaveBeenCalledWith("/workspace", [
		s.request.path,
	]);
	const { serialize: saveState } = await import("./persistence");
	const saved = saveState(s.appStore.get());
	const { undoDelete } = await import("./actions");
	s.appStore.set((state) => ({
		...state,
		tabs: {
			...state.tabs,
			byId: {
				...state.tabs.byId,
				[id]: {
					...state.tabs.byId[id],
					chat: { ...chat, draft: "Newer draft" },
				},
			},
		},
	}));
	expect(await undoDelete()).toBe(true);
	expect(s.appStore.get().tabs.byId[id]).toMatchObject({
		path: s.request.path,
		chat: { draft: "Newer draft" },
	});
	// The saved new-tab conversation remains independently restorable after the delete.

	const restored = await loadStoreActions(
		createDesktopApi(),
		JSON.stringify(saved),
	);
	await restored.restoreTabs();
	expect(restored.tabsStore.get().byId[id]).toEqual(tab);
});

it("does not flush an open buffer over an external edit before staging its deletion", async () => {
	const s = await setup();
	s.api.readFileText.mockResolvedValue("External edit after the tool read");
	expect(
		await s.handleChatFileRequest(
			{ ...s.request, operation: "delete" },
			() => true,
		),
	).toMatchObject({ error: expect.stringContaining("changed") });
	expect(s.api.writeFileText).not.toHaveBeenCalled();
	expect(s.api.stageDelete).not.toHaveBeenCalled();
});
