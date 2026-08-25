// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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
		expect([...editor.querySelectorAll("p")].map((node) => node.dir)).toEqual([
			"auto",
			"auto",
			"auto",
		]);
		expect(
			editor.querySelector(
				"p:last-child > br.ProseMirror-trailingBreak:only-child",
			),
		).not.toBeNull();
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
