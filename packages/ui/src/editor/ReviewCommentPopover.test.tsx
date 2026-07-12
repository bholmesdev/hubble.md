// @vitest-environment happy-dom

import { markdownToTiptapDoc, ReviewMarkExtension } from "@hubble.md/editor";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewCommentPopover } from "./ReviewCommentPopover";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const editors: Editor[] = [];
const roots: Root[] = [];

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	for (const editor of editors) editor.destroy();
	editors.length = 0;
	document.body.replaceChildren();
});

describe("ReviewCommentPopover", () => {
	it("does not leave an empty thread shell when its comment disappears", async () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc("{==commented==}{>>A note<<}{#c1}"),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		renderPopover(editor, viewport);

		const mark = editor.view.dom.querySelector(
			'[data-review-type="reviewComment"]',
		);
		expect(mark).toBeInstanceOf(HTMLElement);
		await act(async () => {
			mark?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(
			document.querySelector("[data-review-comment-popover]"),
		).not.toBeNull();

		await act(async () => {
			const markType = editor.state.schema.marks.reviewMark;
			editor.view.dispatch(editor.state.tr.removeMark(1, 10, markType));
		});

		expect(document.querySelector("[data-review-comment-popover]")).toBeNull();
	});

	it("closes when a pointer starts outside the comment thread", async () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc("{==commented==}{>>A note<<}{#c1}"),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		renderPopover(editor, viewport);

		const mark = editor.view.dom.querySelector(
			'[data-review-type="reviewComment"]',
		);
		await act(async () => {
			mark?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(
			document.querySelector("[data-review-comment-popover]"),
		).not.toBeNull();

		const outside = document.createElement("button");
		document.body.append(outside);
		await act(async () => {
			outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		});

		expect(document.querySelector("[data-review-comment-popover]")).toBeNull();
	});
});

function renderPopover(editor: Editor, viewport: HTMLDivElement) {
	const rootEl = document.createElement("div");
	viewport.append(rootEl);
	const root = createRoot(rootEl);
	roots.push(root);
	act(() => {
		root.render(
			createElement(ReviewCommentPopover, {
				editor,
				filePath: "/notes/plan.md",
				viewportRef: { current: viewport },
				request: 0,
			}),
		);
	});
}
