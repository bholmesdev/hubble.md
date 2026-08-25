// @vitest-environment happy-dom

import type { Editor } from "@tiptap/core";
import { act, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "./EditorView";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { PlainTextEditor } from "./PlainTextEditor";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const roots: Root[] = [];
const noop = () => {};

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	vi.restoreAllMocks();
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	document.body.replaceChildren();
});

describe("editor text direction", () => {
	it("sets automatic direction on rich Markdown blocks", async () => {
		await render(
			<EditorView
				path="note.md"
				initialMarkdown={[
					"# English heading",
					"",
					"פסקה בעברית",
					"",
					"> اقتباس بالعربية",
					"",
					"- פריט ברשימה",
					"",
					"```text",
					"קוד נשאר משמאל לימין",
					"```",
				].join("\n")}
				editable={false}
				onLocalChange={noop}
				onSave={noop}
				onOpenExternalLink={noop}
				onOpenWikiLink={noop}
			/>,
		);

		const editor = getEditor();
		expect(editor.getAttribute("dir")).toBe("auto");
		for (const selector of ["h1", "p", "blockquote", "ul", "li"]) {
			const blocks = editor.querySelectorAll(selector);
			expect(blocks.length).toBeGreaterThan(0);
			for (const block of blocks)
				expect(block.getAttribute("dir")).toBe("auto");
		}
		expect(editor.querySelector(".pm-code-block")?.getAttribute("dir")).toBe(
			"ltr",
		);
	});

	it("sets automatic direction on each plain-text line", async () => {
		mockBrowserDirection();
		await render(
			<PlainTextEditor
				path="note.txt"
				initialText={"English\nעברית\n"}
				onLocalChange={noop}
				onSave={noop}
			/>,
		);

		const editor = getEditor();
		expect(editor.getAttribute("dir")).toBe("auto");
		const paragraphs = [...editor.querySelectorAll("p")];
		expect(paragraphs.map((node) => node.dir)).toEqual([
			"auto",
			"auto",
			"auto",
		]);
		expect(
			paragraphs.map((node) => node.getAttribute("data-empty-direction")),
		).toEqual([null, null, "rtl"]);
		expect(
			editor.querySelector(
				"p:last-child > br.ProseMirror-trailingBreak:only-child",
			),
		).not.toBeNull();
	});

	it("keeps consecutive empty blocks on the previous block's side", async () => {
		mockBrowserDirection();
		await render(
			<EditorView
				path="note.md"
				initialMarkdown="פסקה בעברית"
				onLocalChange={noop}
				onSave={noop}
				onOpenExternalLink={noop}
				onOpenWikiLink={noop}
			/>,
		);

		const editor = getEditorInstance();
		act(() => {
			editor.commands.setTextSelection(editor.state.doc.content.size - 1);
			editor.commands.splitBlock();
			editor.commands.splitBlock();
		});

		const blocks = [...getEditor().children];
		expect(blocks.map((node) => node.getAttribute("dir"))).toEqual([
			"auto",
			"auto",
			"auto",
		]);
		expect(
			blocks.map((node) => node.getAttribute("data-empty-direction")),
		).toEqual([null, "rtl", "rtl"]);

		act(() => {
			editor.commands.insertContent("English");
		});
		expect(getEditor().lastElementChild?.getAttribute("dir")).toBe("auto");
		expect(
			getEditor().lastElementChild?.getAttribute("data-empty-direction"),
		).toBeNull();
	});

	it("keeps source editing left to right", async () => {
		await render(
			<MarkdownSourceEditor
				path="note.md"
				initialMarkdown="פסקה בעברית"
				autoFocus={false}
				onLocalChange={noop}
				onSave={noop}
			/>,
		);

		const editor = getEditor();
		expect(editor.getAttribute("dir")).toBe("ltr");
		expect(editor.querySelector(".pm-code-block")?.getAttribute("dir")).toBe(
			"ltr",
		);
	});
});

async function render(children: ReactNode) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	await act(async () => root.render(children));
}

function getEditor() {
	const editor = document.querySelector<HTMLElement>(".ProseMirror");
	if (!editor) throw new Error("Expected editor");
	return editor;
}

function getEditorInstance() {
	const editor = (getEditor() as HTMLElement & { editor?: Editor }).editor;
	if (!editor) throw new Error("Expected Tiptap editor instance");
	return editor;
}

function mockBrowserDirection() {
	const matches = HTMLElement.prototype.matches;
	vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
		this: HTMLElement,
		selector: string,
	) {
		if (this.tagName === "BDI" && selector === ":dir(rtl)") {
			return /[\u0590-\u08ff]/u.test(this.textContent ?? "");
		}
		return matches.call(this, selector);
	});
}
