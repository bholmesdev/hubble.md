import { afterEach, expect, it, vi } from "vitest";
import { createDesktopApi, loadStoreActions } from "./testUtils";

afterEach(() => vi.unstubAllGlobals());

async function setup() {
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
