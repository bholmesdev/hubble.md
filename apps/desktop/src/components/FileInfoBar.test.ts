// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { filePathForTitlePreview } from "./FileInfoBar";

describe("file info title preview", () => {
	it("shows a pending title before its file is renamed", () => {
		expect(
			filePathForTitlePreview("/workspace/draft-2.md", {
				path: "/workspace/draft-2.md",
				previewPath: "/workspace/draft.md",
			}),
		).toBe("/workspace/draft.md");
	});

	it("does not show another tab's pending title", () => {
		expect(
			filePathForTitlePreview("/workspace/notes.md", {
				path: "/workspace/draft-2.md",
				previewPath: "/workspace/draft.md",
			}),
		).toBe("/workspace/notes.md");
	});
});

it("tracks the new scroll container when notes start at the same scroll position", async () => {
	vi.resetModules();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	Object.defineProperty(window, "desktopApi", {
		value: { platform: "darwin" },
		configurable: true,
	});
	const { FileInfoBar } = await import("./FileInfoBar");
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		const first = document.createElement("div");
		const second = document.createElement("div");
		await act(() =>
			root.render(createElement(FileInfoBar, { scrollContainer: first })),
		);
		await act(() =>
			root.render(createElement(FileInfoBar, { scrollContainer: second })),
		);
		await act(() => {
			second.scrollTop = 50;
			second.dispatchEvent(new Event("scroll"));
		});
		expect(
			host
				.querySelector("[data-file-info-bar]")
				?.classList.contains("after:border-border"),
		).toBe(true);
		await act(() => {
			second.scrollTop = 0;
			second.dispatchEvent(new Event("scroll"));
		});
		expect(
			host
				.querySelector("[data-file-info-bar]")
				?.classList.contains("after:border-transparent"),
		).toBe(true);
	} finally {
		await act(() => root.unmount());
		host.remove();
		vi.unstubAllGlobals();
	}
});
