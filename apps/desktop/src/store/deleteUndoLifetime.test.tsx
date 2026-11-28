// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi } from "../desktopApi/types";
import { createDesktopApi } from "./testUtils";

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	localStorage.clear();
});

it.each([
	"human",
	"agent",
] as const)("keeps the correct Undo lifetime for a %s deletion", async (source) => {
	vi.resetModules();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	localStorage.clear();
	const api = createDesktopApi();
	window.desktopApi = api as unknown as DesktopApi;
	const actions = await import("./actions");
	const { appStore } = await import("./state");
	appStore.set((state) => ({
		...state,
		workspace: { ...state.workspace, workspacePath: "/workspace" },
	}));
	const { Toaster } = await import("../components/Toaster");
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root?.render(<Toaster />));
	vi.useFakeTimers();
	await act(async () => {
		if (source === "human")
			await actions.deleteSidebarItems([
				{ kind: "file", path: "/workspace/note.md" },
			]);
		else {
			const { handleChatFileRequest } = await import("./chatFiles");
			expect(
				await handleChatFileRequest(
					{
						requestId: "request",
						callId: "delete",
						workspacePath: "/workspace",
						path: "/workspace/note.md",
						operation: "delete",
						before: "before",
					},
					() => true,
				),
			).toMatchObject({ open: true });
		}
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	const undo = () =>
		[...document.querySelectorAll("button")].find((button) =>
			button.textContent?.startsWith("Undo"),
		);
	expect(undo()).toBeDefined();
	expect(api.setDeleteUndoAvailable).toHaveBeenLastCalledWith(
		source === "human",
	);
	if (source === "agent") expect(undo()?.textContent).toBe("Undo");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(60_000);
	});
	if (source === "human") {
		expect(api.finalizeDelete).toHaveBeenCalledWith("delete-token");
		expect(undo()).toBeUndefined();
	} else {
		expect(api.finalizeDelete).not.toHaveBeenCalled();
		expect(undo()).toBeDefined();
		await act(async () => undo()?.click());
		expect(api.restoreDelete).toHaveBeenCalledWith("delete-token");
	}
});
