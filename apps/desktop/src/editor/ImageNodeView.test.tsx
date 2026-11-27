// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi } from "../desktopApi/types";

let root: Root | undefined;
let editor: Editor | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	editor?.destroy();
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

async function renderImage() {
	vi.resetModules();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	let resolve!: (path: string) => void;
	const resolvePath = vi.fn(
		() =>
			new Promise<string>((yes) => {
				resolve = yes;
			}),
	);
	window.desktopApi = {
		resolvePath,
		toAssetUrl: (path: string) => `asset:${path}`,
	} as unknown as DesktopApi;
	const { createImageExtension } = await import("./ImageExtension");
	let filePath = "/notes/doc.md";
	editor = new Editor({
		extensions: [StarterKit, createImageExtension(() => filePath)],
		content: '<p>Before</p><img src="image.png"><p>After</p>',
	});
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () =>
		root?.render(<EditorContent editor={editor ?? null} />),
	);
	return {
		host,
		resolvePath,
		resolve,
		setPath: (path: string) => {
			filePath = path;
		},
	};
}

it("does not report a local image as unavailable while its path is resolving", async () => {
	const { host, resolve } = await renderImage();
	expect(host.textContent).not.toContain("Image unavailable");
	await act(async () => resolve("/notes/image.png"));
	const image = host.querySelector("img");
	expect(image?.getAttribute("src")).toBe("asset:/notes/image.png");
	await act(async () => editor?.commands.insertContentAt(2, "typing"));
	expect(host.querySelector("img")).toBe(image);
	expect(host.textContent).not.toContain("Image unavailable");
});

it("keeps a resolved image mounted when its note is renamed in the same folder", async () => {
	const { host, resolve, resolvePath, setPath } = await renderImage();
	await act(async () => resolve("/notes/image.png"));
	const image = host.querySelector("img");
	await act(async () => {
		setPath("/notes/renamed.md");
		const position = editor?.state.doc.firstChild?.nodeSize;
		if (!editor || position === undefined) throw Error("Missing image");
		const node = editor.state.doc.nodeAt(position);
		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(position, undefined, {
				...node?.attrs,
				alt: "Renamed",
			}),
		);
	});
	expect(resolvePath).toHaveBeenCalledTimes(1);
	expect(host.querySelector("img")).toBe(image);
});
