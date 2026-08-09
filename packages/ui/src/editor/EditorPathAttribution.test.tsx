// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { act, type ReactNode, useLayoutEffect } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "./EditorView";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const roots: Root[] = [];
const LONG_SAVE_DEBOUNCE_MS = 60_000;

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("editor path attribution", () => {
	it("preserves rich-editor history when only the physical path changes", async () => {
		const onLocalChange = vi.fn();
		const onSave = vi.fn();
		const root = createTestRoot();
		const getEditor = captureEditorCreation();

		await renderRichEditor(
			root,
			"/old.md",
			"before",
			onLocalChange,
			onSave,
			getEditor,
			null,
			"note-1",
			true,
		);
		const editor = getEditor();
		act(() => changeEditorText(editor, "after"));
		await renderRichEditor(
			root,
			"/renamed.md",
			"after",
			onLocalChange,
			onSave,
			getEditor,
			null,
			"note-1",
		);

		act(() => editor.commands.undo());
		expect(editor.getText()).toBe("before");
	});

	it("preserves rich-editor history when a rename rewrites the body", async () => {
		const root = createTestRoot();
		const getEditor = captureEditorCreation();

		await renderRichEditor(
			root,
			"/old.md",
			"before",
			vi.fn(),
			vi.fn(),
			getEditor,
			null,
			"note-1",
		);
		const editor = getEditor();
		act(() => changeEditorText(editor, "after"));
		await renderRichEditor(
			root,
			"/renamed.md",
			"rewritten after",
			vi.fn(),
			vi.fn(),
			getEditor,
			null,
			"note-1",
			true,
		);

		expect(editor.can().undo()).toBe(true);
	});

	it("attributes a rich editor change and save to the new path", async () => {
		const onLocalChange = vi.fn();
		const onSave = vi.fn();
		const root = createTestRoot();
		const getEditor = captureEditorCreation();

		await renderRichEditor(
			root,
			"/old.md",
			"old",
			onLocalChange,
			onSave,
			getEditor,
		);
		act(() => changeEditorText(getEditor(), "old edited"));
		onLocalChange.mockClear();
		onSave.mockClear();
		await renderRichEditor(
			root,
			"/new.md",
			"new",
			onLocalChange,
			onSave,
			getEditor,
			"edited",
		);

		expect(onLocalChange).toHaveBeenCalledTimes(1);
		expect(onLocalChange).toHaveBeenCalledWith("/new.md", "edited");
		expect(onSave).toHaveBeenCalledTimes(2);
		expect(onSave).toHaveBeenNthCalledWith(1, "/old.md", "old edited");
		expect(onSave).toHaveBeenNthCalledWith(2, "/new.md", "edited");
	});

	it("attributes a source editor change and save to the new path", async () => {
		const onLocalChange = vi.fn();
		const onSave = vi.fn();
		const root = createTestRoot();
		const getEditor = captureEditorCreation();

		await renderSourceEditor(
			root,
			"/old.md",
			"old",
			onLocalChange,
			onSave,
			getEditor,
		);
		act(() => changeEditorText(getEditor(), "old edited"));
		onLocalChange.mockClear();
		onSave.mockClear();
		await renderSourceEditor(
			root,
			"/new.md",
			"new",
			onLocalChange,
			onSave,
			getEditor,
			"edited",
		);

		expect(onLocalChange).toHaveBeenCalledTimes(1);
		expect(onLocalChange).toHaveBeenCalledWith("/new.md", "edited");
		expect(onSave).toHaveBeenCalledTimes(2);
		expect(onSave).toHaveBeenNthCalledWith(1, "/old.md", "old edited");
		expect(onSave).toHaveBeenNthCalledWith(2, "/new.md", "edited");
	});

	it("preserves source-editor history when a rename rewrites the body", async () => {
		const root = createTestRoot();
		const getEditor = captureEditorCreation();

		await renderSourceEditor(
			root,
			"/old.md",
			"before",
			vi.fn(),
			vi.fn(),
			getEditor,
			null,
			"note-1",
		);
		const editor = getEditor();
		act(() => changeEditorText(editor, "after"));
		await renderSourceEditor(
			root,
			"/renamed.md",
			"rewritten after",
			vi.fn(),
			vi.fn(),
			getEditor,
			null,
			"note-1",
			true,
		);

		expect(editor.can().undo()).toBe(true);
	});
});

function createTestRoot() {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	return root;
}

async function renderRichEditor(
	root: Root,
	path: string,
	initialMarkdown: string,
	onLocalChange: ReturnType<typeof vi.fn>,
	onSave: ReturnType<typeof vi.fn>,
	getEditor: () => Editor,
	editText: string | null = null,
	documentId?: string,
	preserveHistoryOnUpdate = false,
) {
	await act(async () => {
		root.render(
			<EditAfterChildLayout editText={editText} getEditor={getEditor}>
				<EditorView
					path={path}
					documentId={documentId}
					preserveHistoryOnUpdate={preserveHistoryOnUpdate}
					initialMarkdown={initialMarkdown}
					editable={false}
					saveDebounceMs={LONG_SAVE_DEBOUNCE_MS}
					onLocalChange={onLocalChange}
					onSave={onSave}
					onOpenExternalLink={() => {}}
					onOpenWikiLink={() => {}}
				/>
			</EditAfterChildLayout>,
		);
	});
}

async function renderSourceEditor(
	root: Root,
	path: string,
	initialMarkdown: string,
	onLocalChange: ReturnType<typeof vi.fn>,
	onSave: ReturnType<typeof vi.fn>,
	getEditor: () => Editor,
	editText: string | null = null,
	documentId?: string,
	preserveHistoryOnUpdate = false,
) {
	await act(async () => {
		root.render(
			<EditAfterChildLayout editText={editText} getEditor={getEditor}>
				<MarkdownSourceEditor
					path={path}
					documentId={documentId}
					preserveHistoryOnUpdate={preserveHistoryOnUpdate}
					initialMarkdown={initialMarkdown}
					saveDebounceMs={LONG_SAVE_DEBOUNCE_MS}
					onLocalChange={onLocalChange}
					onSave={onSave}
				/>
			</EditAfterChildLayout>,
		);
	});
}

function EditAfterChildLayout({
	children,
	editText,
	getEditor,
}: {
	children: ReactNode;
	editText: string | null;
	getEditor: () => Editor;
}) {
	useLayoutEffect(() => {
		if (editText === null) return;
		changeEditorText(getEditor(), editText);
	}, [editText, getEditor]);
	return children;
}

function captureEditorCreation() {
	let editor: Editor | null = null;
	type EditorPrototypeWithCreateView = {
		createView(this: Editor, element: HTMLElement): void;
	};
	const prototype =
		Editor.prototype as unknown as EditorPrototypeWithCreateView;
	const createView = prototype.createView;
	vi.spyOn(prototype, "createView").mockImplementation(function (
		this: Editor,
		element,
	) {
		editor = this;
		createView.call(this, element);
	});
	return () => {
		expect(editor).toBeInstanceOf(Editor);
		return editor as Editor;
	};
}

function changeEditorText(editor: Editor, text: string) {
	editor.commands.selectAll();
	editor.commands.insertContent(text);
}
