// @vitest-environment happy-dom

import { getActiveEditor } from "@hubble.md/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMarkdownFile } from "./fileActions";
import { createMarkdownFileInFolder } from "./store/actions";
import { viewerStore, workspaceStore } from "./store/state";

vi.mock("@hubble.md/ui", () => ({ getActiveEditor: vi.fn() }));
vi.mock("./store/actions", () => ({
	createHtmlFileInFolder: vi.fn(),
	createMarkdownFileInFolder: vi.fn(),
}));
vi.mock("./store/state", () => ({
	viewerStore: { get: vi.fn() },
	workspaceStore: { get: vi.fn() },
}));

const focus = vi.fn();
let pendingFrame: FrameRequestCallback | null = null;
const nextFrame = vi.fn((callback: FrameRequestCallback) => {
	pendingFrame = callback;
	return 1;
});

beforeEach(() => {
	vi.clearAllMocks();
	pendingFrame = null;
	vi.stubGlobal("requestAnimationFrame", nextFrame);
	vi.mocked(workspaceStore.get).mockReturnValue({
		workspacePath: "/workspace",
	} as never);
	vi.mocked(getActiveEditor).mockReturnValue({
		commands: { focus },
	} as never);
});

function renderNextFrame() {
	if (!pendingFrame) throw new Error("No frame was requested");
	const callback = pendingFrame;
	pendingFrame = null;
	callback(0);
}

describe("createMarkdownFile", () => {
	it("focuses the editor after the created Markdown file renders", async () => {
		vi.mocked(createMarkdownFileInFolder).mockResolvedValue(
			"/workspace/new-file.md",
		);
		vi.mocked(viewerStore.get).mockReturnValue({
			currentPath: "/workspace/new-file.md",
		} as never);
		await createMarkdownFile();

		expect(nextFrame).toHaveBeenCalledOnce();
		expect(focus).not.toHaveBeenCalled();
		renderNextFrame();
		expect(focus).toHaveBeenCalledWith("end");
	});

	it("does not focus after creation fails", async () => {
		vi.mocked(createMarkdownFileInFolder).mockResolvedValue(null);
		await createMarkdownFile();

		expect(nextFrame).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
	});

	it("does not steal focus if another file opens before the next frame", async () => {
		vi.mocked(createMarkdownFileInFolder).mockResolvedValue(
			"/workspace/new-file.md",
		);
		vi.mocked(viewerStore.get).mockReturnValue({
			currentPath: "/workspace/new-file.md",
		} as never);
		await createMarkdownFile();
		vi.mocked(viewerStore.get).mockReturnValue({
			currentPath: "/workspace/other.md",
		} as never);
		renderNextFrame();

		expect(getActiveEditor).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
	});
});
