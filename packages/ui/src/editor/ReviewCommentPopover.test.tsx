// @vitest-environment happy-dom

import { markdownToTiptapDoc, ReviewMarkExtension } from "@hubble.md/editor";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

	it("offers the agent prompt on the thread itself, not behind a menu", async () => {
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

		const writeText = stubClipboard();
		const mark = editor.view.dom.querySelector(
			'[data-review-type="reviewComment"]',
		);
		await act(async () => {
			mark?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		const copy = document.querySelector<HTMLButtonElement>(
			"[data-review-comment-popover] [data-review-copy-agent-prompt]",
		);
		expect(copy).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			copy?.click();
		});

		expect(writeText).toHaveBeenCalledWith(
			"Address comment c1 in /notes/plan.md",
		);
	});

	it("publishes threads and opens one on request from the status bar", async () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc(
				"{==first==}{>>Note one<<}{#c1}\n\n{==second==}{>>Note two<<}{#c2}",
			),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		const onCommentsChange = vi.fn();
		const render = renderPopover(editor, viewport, { onCommentsChange });

		expect(onCommentsChange).toHaveBeenCalled();
		const published = onCommentsChange.mock.lastCall?.[0] as { id: string }[];
		expect(published.map((comment) => comment.id)).toEqual(["c1", "c2"]);

		await act(async () => {
			render({ openRequest: { id: "c2", nonce: 1 } });
		});

		const popover = document.querySelector("[data-review-comment-popover]");
		expect(popover?.textContent).toContain("Note two");
	});

	it("deletes only the clicked occurrence when an id is reused", async () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc(
				"{==first==}{>>A note<<}{#duplicate}\n\n{++middle++}{#suggestion}\n\n{==second==}{>>A note<<}{#duplicate}",
			),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		renderPopover(editor, viewport);

		const marks = editor.view.dom.querySelectorAll(
			'[data-review-type="reviewComment"]',
		);
		expect(marks).toHaveLength(2);
		await act(async () => {
			marks[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		const trash = document.querySelector<HTMLButtonElement>(
			'[data-review-comment-popover] [aria-label="Delete comment"]',
		);
		await act(async () => {
			trash?.click();
		});

		expect(reviewMarkAtText(editor, "first")).toBeUndefined();
		expect(reviewMarkAtText(editor, "middle")?.attrs).toMatchObject({
			type: "reviewInsertion",
			id: "suggestion",
		});
		expect(reviewMarkAtText(editor, "second")?.attrs).toMatchObject({
			type: "reviewComment",
			id: "duplicate",
		});
	});

	it("keeps an open duplicate-id occurrence active when earlier text shifts it", async () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc(
				"{==first==}{>>A note<<}{#duplicate}\n\n{==second==}{>>A note<<}{#duplicate}",
			),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		renderPopover(editor, viewport);

		const marks = editor.view.dom.querySelectorAll(
			'[data-review-type="reviewComment"]',
		);
		await act(async () => {
			marks[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await act(async () => {
			editor.commands.insertContentAt(1, "prefix ");
		});

		const quote = document.querySelector("blockquote");
		expect(quote?.textContent).toBe("second");
	});

	it("sends a reply on Enter and keeps Shift+Enter as a newline", async () => {
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

		const textarea = document.querySelector<HTMLTextAreaElement>(
			'[aria-label="Reply text"]',
		);
		expect(textarea).not.toBeNull();
		if (!textarea) return;

		await act(async () => {
			setReactTextareaValue(textarea, "Sounds good");
		});
		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(collectReplies(editor)).toHaveLength(0);

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		const replies = collectReplies(editor);
		expect(replies).toHaveLength(1);
		expect(replies[0]?.body).toBe("Sounds good");
	});

	// An id-less comment is valid CriticMarkup, but collectComments can't key on
	// it, so it has to block the new comment rather than reopen as a thread.
	it.each([
		[
			"a review suggestion",
			"Before {++inserted text++}{#s1} after",
			"inserted",
		],
		[
			"an id-less comment",
			"Before {==commented==}{>>note<<} after",
			"commented",
		],
	])("refuses to add a comment over %s", async (_label, markdown, target) => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc(markdown),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		const messages: { message: string; type: string }[] = [];
		const onMessage = (message: string, type: string) =>
			messages.push({ message, type });
		const rerender = renderPopover(editor, viewport, { onMessage });

		await act(async () => {
			const { from, to } = findTextPosition(editor, target);
			editor.commands.setTextSelection({ from, to });
		});
		await act(async () => {
			rerender({ request: 1, onMessage });
		});

		expect(document.querySelector("[data-review-comment-popover]")).toBeNull();
		expect(messages.some((m) => m.type === "error")).toBe(true);
	});

	it("does not reuse a deleted comment's id after the popover remounts", async () => {
		// Reopening the file remounts the popover with the same doc, so a
		// counter derived from the current comments would reissue a deleted id.
		// Simulate that remount.
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc("{==first==}{>>A<<}{#c1} plain text"),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);

		const firstMount = renderPopover(editor, viewport);
		await act(async () => {
			const { from, to } = findCommentRange(editor, "c1");
			const markType = editor.state.schema.marks.reviewMark;
			editor.view.dispatch(editor.state.tr.removeMark(from, to, markType));
		});
		await act(() => firstMount.unmount());

		const rerender = renderPopover(editor, viewport);
		await act(async () => {
			const { from, to } = findTextPosition(editor, "plain");
			editor.commands.setTextSelection({ from, to });
		});
		await act(async () => {
			rerender({ request: 1 });
		});

		const textarea = document.querySelector<HTMLTextAreaElement>(
			'[aria-label="Comment text"]',
		);
		expect(textarea).not.toBeNull();
		if (!textarea) return;
		await act(async () => {
			setReactTextareaValue(textarea, "New note");
		});
		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(collectCommentIds(editor).has("c1")).toBe(false);
	});

	it("shows a hover comment button for the block under the pointer and comments on it", async () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: [StarterKit, ReviewMarkExtension],
			content: markdownToTiptapDoc("First paragraph.\n\nSecond paragraph."),
		});
		editors.push(editor);

		const viewport = document.createElement("div");
		viewport.append(editor.view.dom);
		document.body.append(viewport);
		renderPopover(editor, viewport);

		vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 800, 600),
		);
		vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue(
			new DOMRect(100, 0, 600, 600),
		);
		editor.view.dom.style.paddingInlineEnd = "48px";

		// ProseMirror can't resolve positions inside its padding, so mirror that
		// here: the hover probe must use the text edge, not the editor edge.
		const { from } = findTextPosition(editor, "Second paragraph");
		editor.view.posAtCoords = ({ left }) =>
			left <= 651 ? { pos: from, inside: from } : null;

		expect(document.querySelector('[aria-label="Add comment"]')).toBeNull();

		await act(async () => {
			viewport.dispatchEvent(
				new MouseEvent("mousemove", {
					bubbles: true,
					clientX: 610,
					clientY: 100,
				}),
			);
		});

		const hoverButton = document.querySelector<HTMLButtonElement>(
			'[aria-label="Add comment"]',
		);
		expect(hoverButton).not.toBeNull();
		if (!hoverButton) return;

		await act(async () => {
			hoverButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		const textarea = document.querySelector<HTMLTextAreaElement>(
			'[aria-label="Comment text"]',
		);
		expect(textarea).not.toBeNull();
		if (!textarea) return;
		await act(async () => {
			setReactTextareaValue(textarea, "Block-level note");
		});
		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		const commented: string[] = [];
		editor.state.doc.descendants((node) => {
			if (
				node.isText &&
				node.marks.some(
					(mark) =>
						mark.type.name === "reviewMark" &&
						mark.attrs.type === "reviewComment",
				)
			) {
				commented.push(node.text ?? "");
			}
			return true;
		});
		expect(commented.join("")).toBe("Second paragraph.");
	});
});

function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
	// React overrides the value setter on the element; go through the prototype
	// setter so React's onChange sees the update.
	const setter = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter?.call(textarea, value);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function collectReplies(editor: Editor) {
	const replies: { body: string }[] = [];
	editor.state.doc.descendants((node) => {
		for (const mark of node.marks) {
			if (
				mark.type.name === "reviewMark" &&
				Array.isArray(mark.attrs.replies)
			) {
				replies.push(...mark.attrs.replies);
				return false;
			}
		}
		return true;
	});
	return replies;
}

function renderPopover(
	editor: Editor,
	viewport: HTMLDivElement,
	extraProps: Record<string, unknown> = {},
) {
	const rootEl = document.createElement("div");
	viewport.append(rootEl);
	const root = createRoot(rootEl);
	roots.push(root);
	const render = (props: Record<string, unknown> = {}) => {
		root.render(
			createElement(ReviewCommentPopover, {
				editor,
				filePath: "/notes/plan.md",
				viewportRef: { current: viewport },
				request: 0,
				...extraProps,
				...props,
			}),
		);
	};
	render.unmount = () => {
		root.unmount();
		rootEl.remove();
		const index = roots.indexOf(root);
		if (index !== -1) roots.splice(index, 1);
	};
	act(() => render());
	return render;
}

function stubClipboard() {
	const writeText = vi.fn(async () => {});
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	return writeText;
}

function findTextPosition(editor: Editor, text: string) {
	let result: { from: number; to: number } | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (result || !node.isText || !node.text) return true;
		const idx = node.text.indexOf(text);
		if (idx === -1) return true;
		result = { from: pos + idx, to: pos + idx + text.length };
		return false;
	});
	if (!result) throw new Error(`text not found: ${text}`);
	return result;
}

function reviewMarkAtText(editor: Editor, text: string) {
	const { from } = findTextPosition(editor, text);
	return editor.state.doc
		.nodeAt(from)
		?.marks.find((mark) => mark.type.name === "reviewMark");
}

function findCommentRange(editor: Editor, id: string) {
	let from = -1;
	let to = -1;
	editor.state.doc.descendants((node, pos) => {
		for (const mark of node.marks) {
			if (mark.type.name === "reviewMark" && mark.attrs.id === id) {
				from = from === -1 ? pos : Math.min(from, pos);
				to = Math.max(to, pos + node.nodeSize);
			}
		}
		return true;
	});
	if (from === -1) throw new Error(`comment not found: ${id}`);
	return { from, to };
}

function collectCommentIds(editor: Editor) {
	const ids = new Set<string>();
	editor.state.doc.descendants((node) => {
		for (const mark of node.marks) {
			if (
				mark.type.name === "reviewMark" &&
				mark.attrs.type === "reviewComment" &&
				typeof mark.attrs.id === "string"
			) {
				ids.add(mark.attrs.id);
			}
		}
		return true;
	});
	return ids;
}
