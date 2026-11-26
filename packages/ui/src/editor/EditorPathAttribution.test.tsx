// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { act, type ReactNode, useLayoutEffect } from "react";
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

it("keeps a new property draft mounted and focused while typing", async () => {
	const { onLocalChange } = await mountEditor("Body");
	const add = [...document.querySelectorAll("button")].find(
		(button) => button.textContent === "Add property",
	);
	act(() => add?.click());
	const input = propertyName();
	act(() => input.focus());
	for (const value of ["t", "to", "topic"]) {
		act(() => typeInput(input, value));
		expect(propertyName()).toBe(input);
		expect(document.activeElement).toBe(input);
		expect(input.value).toBe(value);
	}
	act(() => input.blur());
	expect(onLocalChange).toHaveBeenLastCalledWith(
		"/note.md",
		expect.stringContaining("topic:"),
	);
});

for (const kind of ["rich", "source"] as const) {
	it(`undoes an agent update as one ${kind} editor action, including front matter`, async () => {
		const before = "---\ntitle: Before\n---\n\nBefore body";
		const after = "---\ntitle: After\n---\n\nAfter body";
		const { editor, onLocalChange, render } = await mountEditor(before, kind);
		await render(after, "agent-1");
		expect(editor.getText()).toContain("After body");
		act(() => editor.commands.undo());
		expect(editor.getText()).toContain("Before body");
		expect(onLocalChange).toHaveBeenLastCalledWith(
			"/note.md",
			expect.stringContaining("title: Before"),
		);
		act(() => editor.commands.redo());
		expect(onLocalChange).toHaveBeenLastCalledWith(
			"/note.md",
			expect.stringContaining("title: After"),
		);
		await render(after.replace("After body", "Second agent edit"), "agent-2");
		act(() => editor.commands.undo());
		expect(editor.getText()).toContain("After body");
	});
}

it("keeps a plain-text agent edit separate from prior human typing", async () => {
	const { editor, onLocalChange, render } = await mountEditor(
		"Before",
		"plain",
	);
	act(() => changeEditorText(editor, "Human edit"));
	await render("Human edit plus agent edit", "agent-1");
	act(() => editor.commands.undo());
	expect(editor.getText()).toBe("Human edit");
	expect(onLocalChange).toHaveBeenLastCalledWith("/note.txt", "Human edit");
	act(() => editor.commands.undo());
	expect(editor.getText()).toBe("Before");
	act(() => editor.commands.redo());
	act(() => editor.commands.redo());
	expect(editor.getText()).toBe("Human edit plus agent edit");
});

async function mountEditor(
	content = "---\ntitle: Before\n---\n\nBody",
	kind: "rich" | "source" | "plain" = "rich",
) {
	const root = createTestRoot();
	const getEditor = captureEditorCreation();
	const onLocalChange = vi.fn();
	const onSave = vi.fn();
	const path = kind === "plain" ? "/note.txt" : "/note.md";
	const render = async (text = content, undoableUpdate?: string) =>
		act(async () => {
			const props = {
				path,
				onLocalChange,
				onSave,
				saveDebounceMs: LONG_SAVE_DEBOUNCE_MS,
				undoableUpdate,
			};
			root.render(
				kind === "plain" ? (
					<PlainTextEditor {...props} initialText={text} />
				) : kind === "source" ? (
					<MarkdownSourceEditor {...props} initialMarkdown={text} />
				) : (
					<EditorView
						{...props}
						initialMarkdown={text}
						onOpenExternalLink={() => {}}
						onOpenWikiLink={() => {}}
					/>
				),
			);
		});
	await render();
	return { editor: getEditor(), onLocalChange, render };
}

function propertyName() {
	const input = document.querySelector<HTMLInputElement>(
		"[data-property-name]",
	);
	if (!input) throw Error("Missing property name");
	return input;
}
function typeInput(
	input: HTMLInputElement | HTMLTextAreaElement,
	value: string,
) {
	const setter = Object.getOwnPropertyDescriptor(
		input instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("undoes a property-name editing session as one change, like a value edit", async () => {
	const { editor, onLocalChange } = await mountEditor();
	const input = propertyName();
	act(() => input.focus());
	for (const value of ["titlex", "titlexy", "titlexyz"])
		act(() => typeInput(input, value));
	act(() => input.blur());
	act(() => editor.commands.undo());
	expect(propertyName().value).toBe("title");
	expect(onLocalChange).toHaveBeenLastCalledWith(
		"/note.md",
		expect.stringContaining("title: Before"),
	);
	act(() => editor.commands.redo());
	expect(propertyName().value).toBe("titlexyz");
	expect(editor.getText()).toBe("Body");
});

it("keeps the property input and caret stable through metadata undo and redo", async () => {
	const { editor } = await mountEditor();
	const input = propertyName();
	act(() => {
		input.focus();
		typeInput(input, "topic");
	});
	act(() => input.blur());
	act(() => {
		input.focus();
		input.setSelectionRange(2, 4);
	});
	act(() => editor.commands.undo());
	expect(propertyName()).toBe(input);
	expect(document.activeElement).toBe(input);
	expect(input.value).toBe("title");
	expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
	act(() => editor.commands.redo());
	expect(propertyName()).toBe(input);
	expect(document.activeElement).toBe(input);
	expect(input.value).toBe("topic");
	expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
});

it("undoes and redoes an empty property draft even before it has YAML text", async () => {
	const { editor } = await mountEditor();
	const add = [...document.querySelectorAll("button")].find(
		(button) => button.textContent === "Add property",
	);
	act(() => add?.click());
	expect(document.querySelectorAll("[data-property-name]")).toHaveLength(2);
	act(() => editor.commands.undo());
	expect(document.querySelectorAll("[data-property-name]")).toHaveLength(1);
	act(() => editor.commands.redo());
	expect(document.querySelectorAll("[data-property-name]")).toHaveLength(2);
});

it("keeps the document body mounted through front-matter edits and undo", async () => {
	const { editor } = await mountEditor();
	const paragraph = document.querySelector(".ProseMirror p");
	expect(paragraph).not.toBeNull();
	const input = propertyName();
	act(() => {
		input.focus();
		typeInput(input, "topic");
	});
	act(() => input.blur());
	expect(document.querySelector(".ProseMirror p")).toBe(paragraph);
	act(() => editor.commands.undo());
	expect(document.querySelector(".ProseMirror p")).toBe(paragraph);
	act(() => editor.commands.redo());
	expect(document.querySelector(".ProseMirror p")).toBe(paragraph);
});

it("keeps the document body mounted through an external front-matter-only update", async () => {
	const { editor, render, onLocalChange } = await mountEditor();
	const paragraph = document.querySelector(".ProseMirror p");
	await render("---\ntitle: External\n---\n\nBody", "metadata-update");
	expect(document.querySelector(".ProseMirror p")).toBe(paragraph);
	act(() => editor.commands.undo());
	expect(document.querySelector(".ProseMirror p")).toBe(paragraph);
	expect(onLocalChange).toHaveBeenLastCalledWith(
		"/note.md",
		expect.stringContaining("title: Before"),
	);
	act(() => editor.commands.redo());
	expect(document.querySelector(".ProseMirror p")).toBe(paragraph);
	expect(onLocalChange).toHaveBeenLastCalledWith(
		"/note.md",
		expect.stringContaining("title: External"),
	);
});

it("publishes a property-name draft before blur so keyboard navigation can save it", async () => {
	const { onLocalChange } = await mountEditor();
	const input = propertyName();
	act(() => {
		input.focus();
		typeInput(input, "topic");
	});
	expect(document.activeElement).toBe(input);
	expect(onLocalChange).toHaveBeenLastCalledWith(
		"/note.md",
		expect.stringContaining("topic:"),
	);
});

it("skips unchanged property values when undoing a name edit", async () => {
	const { editor } = await mountEditor();
	const name = propertyName();
	act(() => {
		name.focus();
		typeInput(name, "topic");
	});
	act(() => name.blur());
	const value = document.querySelector<HTMLTextAreaElement>(
		".editorPropertiesPanel textarea",
	);
	act(() => value?.focus());
	act(() => value?.blur());
	act(() => editor.commands.undo());
	expect(propertyName().value).toBe("title");
});

it("restores the visible raw YAML along with saved metadata on undo", async () => {
	const { editor, onLocalChange } = await mountEditor(
		"---\ntitle: [\n---\n\nBody",
	);
	const input = document.querySelector<HTMLTextAreaElement>(
		".editorPropertiesPanel textarea",
	);
	if (!input) throw Error("Missing raw YAML input");
	act(() => {
		input.focus();
		typeInput(input, "title: [broken");
	});
	act(() => editor.commands.undo());
	expect(onLocalChange).toHaveBeenLastCalledWith(
		"/note.md",
		expect.stringContaining("title: [\n"),
	);
	expect(input.value).toBe("title: [");
});
