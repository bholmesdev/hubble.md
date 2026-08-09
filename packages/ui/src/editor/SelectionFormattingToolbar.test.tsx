// @vitest-environment happy-dom

import { Editor, Extension, type JSONContent } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { act, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionFormattingToolbar } from "./SelectionFormattingToolbar";

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
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("SelectionFormattingToolbar", () => {
	it("dismisses on Escape without changing the editor text selection", async () => {
		const editor = createEditor(docWithParagraph("hello world"), {
			consumeEscape: true,
		});
		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);

		const selection = { from: 1, to: 6 };
		selectText(editor, selection.from, selection.to);

		renderToolbar(editor, viewport);
		await waitForToolbarToShow();

		const toolbar = getToolbar();
		expect(toolbar.hasAttribute("data-open")).toBe(true);

		await act(async () => {
			editor.view.dom.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(toolbar.hasAttribute("data-open")).toBe(false);
		expect(editor.state.selection.from).toBe(selection.from);
		expect(editor.state.selection.to).toBe(selection.to);

		act(() => {
			editor.view.dispatch(editor.state.tr.scrollIntoView());
		});

		expect(toolbar.hasAttribute("data-open")).toBe(false);

		act(() => {
			selectText(editor, 2, 7);
		});
		await waitForToolbarToShow();

		expect(toolbar.hasAttribute("data-open")).toBe(true);
	});

	it("does not dismiss when another capture handler consumes Escape first", async () => {
		const editor = createEditor(docWithParagraph("hello world"));
		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);

		selectText(editor, 1, 6);
		renderToolbar(editor, viewport);
		await waitForToolbarToShow();

		const toolbar = getToolbar();
		const consumeEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener("keydown", consumeEscape, true);

		await act(async () => {
			editor.view.dom.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		window.removeEventListener("keydown", consumeEscape, true);
		expect(toolbar.hasAttribute("data-open")).toBe(true);
	});

	it("offers a comment action when the editor provides one", async () => {
		const editor = createEditor(docWithParagraph("hello world"));
		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		const onComment = vi.fn();

		selectText(editor, 1, 6);
		renderToolbar(editor, viewport, onComment);
		await waitForToolbarToShow();

		const button = document.querySelector('[aria-label="Comment"]');
		expect(button).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			(button as HTMLButtonElement).click();
		});
		expect(onComment).toHaveBeenCalledOnce();
	});

	it("hides actions from the right as the viewport narrows", async () => {
		const resize = stubResizeObserver();
		const editor = createEditor(docWithParagraph("hello world"));
		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		let width = 500;
		Object.defineProperty(viewport, "clientWidth", { get: () => width });

		selectText(editor, 1, 6);
		renderToolbar(editor, viewport, () => {});
		await waitForToolbarToShow();

		expect(document.querySelector('[aria-label="Quote"]')).not.toBeNull();
		expect(document.querySelector('[aria-label="Comment"]')).not.toBeNull();

		act(() => {
			width = 360;
			resize();
		});

		expect(
			document.querySelector('[aria-label="Numbered list"]'),
		).not.toBeNull();
		expect(document.querySelector('[aria-label="To-do list"]')).toBeNull();
		expect(document.querySelector('[aria-label="Quote"]')).toBeNull();
		expect(document.querySelector('[aria-label="Comment"]')).toBeNull();
		expect(
			document.querySelector('[aria-label="More formatting"]'),
		).not.toBeNull();
	});
});

// Happy DOM's ResizeObserver never fires, so hand the test its callback.
function stubResizeObserver() {
	let notify = () => {};
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				notify = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	return () => notify();
}

function renderToolbar(
	editor: Editor,
	viewport: HTMLDivElement,
	onComment?: () => void,
) {
	const rootEl = document.createElement("div");
	viewport.append(rootEl);
	const root = createRoot(rootEl);
	roots.push(root);
	act(() => {
		root.render(
			<SelectionFormattingToolbar
				editor={editor}
				viewportRef={{ current: viewport }}
				onComment={onComment}
			/>,
		);
	});
}

function createEditor(
	content: JSONContent,
	options: { consumeEscape?: boolean } = {},
) {
	const editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit,
			options.consumeEscape ? EscapeConsumerExtension : null,
		].filter((extension) => extension !== null),
		content,
	});
	editors.push(editor);
	Object.defineProperty(editor, "isFocused", { value: true });
	vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({
		top: 10,
		right: 60,
		bottom: 30,
		left: 20,
	});
	return editor;
}

const EscapeConsumerExtension = Extension.create({
	name: "escapeConsumer",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handleKeyDown(_view, event) {
						if (event.key !== "Escape") return false;
						event.preventDefault();
						return true;
					},
				},
			}),
		];
	},
});

function selectText(editor: Editor, from: number, to: number) {
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, from, to),
		),
	);
}

async function waitForToolbarToShow() {
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 175));
	});
	await act(async () => {
		await Promise.resolve();
	});
}

function getToolbar() {
	const toolbar = document.querySelector('[role="toolbar"]');
	expect(toolbar).toBeInstanceOf(HTMLElement);
	return toolbar as HTMLElement;
}

function docWithParagraph(text: string): JSONContent {
	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text }],
			},
		],
	};
}
