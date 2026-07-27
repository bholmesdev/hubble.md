import type { Editor } from "@tiptap/core";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
	flushPendingSave,
	type PendingSave,
	schedulePendingSave,
} from "./pendingSave";
import { VirtualCursor } from "./VirtualCursor";
import "./EditorView.css";

const DEFAULT_SAVE_DEBOUNCE_MS = 120;

export type PlainTextEditorProps = {
	path: string;
	initialText: string;
	saveDebounceMs?: number;
	onLocalChange: (path: string, text: string) => void;
	onSave: (path: string, text: string) => void | Promise<void>;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
};

export function PlainTextEditor({
	path,
	initialText,
	saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
	onLocalChange,
	onSave,
	onScrollContainerChange,
}: PlainTextEditorProps) {
	const pathRef = useRef(path);
	const latestTextRef = useRef(initialText);
	const pendingSaveRef = useRef<PendingSave | null>(null);
	const editorRootRef = useRef<HTMLDivElement | null>(null);
	const editorViewportRef = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		pathRef.current = path;
	}, [path]);

	const setEditorViewport = (node: HTMLDivElement | null) => {
		editorViewportRef.current = node;
		onScrollContainerChange?.(node);
	};

	const scheduleSave = () => {
		schedulePendingSave({
			delay: saveDebounceMs,
			markdown: latestTextRef.current,
			path: pathRef.current,
			ref: pendingSaveRef,
			save: onSave,
		});
	};

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				blockquote: false,
				bold: false,
				bulletList: false,
				code: false,
				codeBlock: false,
				dropcursor: false,
				gapcursor: false,
				hardBreak: false,
				heading: false,
				horizontalRule: false,
				italic: false,
				link: false,
				listItem: false,
				listKeymap: false,
				orderedList: false,
				strike: false,
				trailingNode: false,
				underline: false,
			}),
		],
		content: plainTextDocFromText(initialText),
		onUpdate: ({ editor: current }) => {
			const text = plainTextFromDoc(current);
			latestTextRef.current = text;
			onLocalChange(pathRef.current, text);
			scheduleSave();
		},
		editorProps: {
			attributes: {
				"data-editor-input": "",
				"aria-label": "Plain text editor",
			},
		},
	});

	useEffect(() => {
		if (!editor) return;
		if (initialText === latestTextRef.current) return;
		latestTextRef.current = initialText;
		editor.commands.setContent(plainTextDocFromText(initialText), {
			emitUpdate: false,
		});
	}, [editor, initialText]);

	useEffect(() => {
		void path;
		return () => flushPendingSave(pendingSaveRef);
	}, [path]);

	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			ref={editorRootRef}
			data-hubble-editor
			data-hubble-plain-text-editor
		>
			<div
				className="editorViewport relative min-h-0 flex-1 overflow-auto overscroll-contain"
				ref={setEditorViewport}
			>
				<EditorContent editor={editor} />
				<VirtualCursor
					editor={editor}
					containerRef={editorRootRef}
					viewportRef={editorViewportRef}
				/>
			</div>
		</div>
	);
}

export function plainTextDocFromText(text: string): JSONContent {
	return {
		type: "doc",
		content: text.split("\n").map((paragraph) => ({
			type: "paragraph",
			content: paragraph.length > 0 ? [{ type: "text", text: paragraph }] : [],
		})),
	};
}

export function plainTextFromDoc(editor: Editor): string {
	const paragraphs: string[] = [];
	editor.state.doc.forEach((node) => {
		paragraphs.push(node.textContent);
	});
	return paragraphs.join("\n");
}
