import type { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useLayoutEffect, useRef } from "react";
import { HubbleCodeBlock } from "./CodeBlockExtension";
import {
	flushPendingSave,
	type PendingSave,
	schedulePendingSave,
} from "./pendingSave";
import "./EditorView.css";

const DEFAULT_SAVE_DEBOUNCE_MS = 120;
const SourceDocument = Document.extend({ content: "codeBlock" });

export type MarkdownSourceEditorProps = {
	path: string;
	initialMarkdown: string;
	sourceLanguage?: string;
	/** Focus on mount; wanted for the source-mode toggle, not for navigation. */
	autoFocus?: boolean;
	saveDebounceMs?: number;
	onLocalChange: (path: string, markdown: string) => void;
	onSave: (path: string, markdown: string) => void | Promise<void>;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
};

export function MarkdownSourceEditor({
	path,
	initialMarkdown,
	sourceLanguage = "md",
	autoFocus = true,
	saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
	onLocalChange,
	onSave,
	onScrollContainerChange,
}: MarkdownSourceEditorProps) {
	const pathRef = useRef(path);
	const latestMarkdownRef = useRef(initialMarkdown);
	const pendingSaveRef = useRef<PendingSave | null>(null);
	useLayoutEffect(() => {
		pathRef.current = path;
	}, [path]);

	const setEditorViewport = (node: HTMLDivElement | null) => {
		onScrollContainerChange?.(node);
	};

	const scheduleSave = () => {
		schedulePendingSave({
			delay: saveDebounceMs,
			markdown: latestMarkdownRef.current,
			path: pathRef.current,
			ref: pendingSaveRef,
			save: onSave,
		});
	};

	const editor = useEditor({
		extensions: [
			SourceDocument,
			StarterKit.configure({ codeBlock: false, document: false }),
			HubbleCodeBlock.configure({ defaultLanguage: sourceLanguage }),
		],
		content: sourceDocFromMarkdown(initialMarkdown, sourceLanguage),
		onUpdate: ({ editor: current }) => {
			const markdown = markdownFromSourceDoc(current);
			latestMarkdownRef.current = markdown;
			onLocalChange(pathRef.current, markdown);
			scheduleSave();
		},
		editorProps: {
			attributes: {
				"data-editor-input": "",
				"aria-label":
					sourceLanguage === "html"
						? "HTML source"
						: sourceLanguage === "text"
							? "Text editor"
							: sourceLanguage === "md"
								? "Markdown source"
								: "Code editor",
			},
		},
	});

	useEffect(() => {
		if (!editor || !autoFocus) return;
		editor.commands.focus("end");
	}, [editor, autoFocus]);

	useEffect(() => {
		if (!editor) return;
		if (initialMarkdown === latestMarkdownRef.current) return;
		latestMarkdownRef.current = initialMarkdown;
		editor.commands.setContent(
			sourceDocFromMarkdown(initialMarkdown, sourceLanguage),
			{
				emitUpdate: false,
			},
		);
	}, [editor, initialMarkdown, sourceLanguage]);

	useEffect(() => {
		// Path changes flush the pending edit before the next document takes over.
		void path;
		return () => {
			flushPendingSave(pendingSaveRef);
		};
	}, [path]);

	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			data-hubble-editor
			data-hubble-source-editor
		>
			<div
				className="editorViewport relative min-h-0 flex-1 overflow-auto overscroll-contain"
				ref={setEditorViewport}
			>
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}

export function sourceDocFromMarkdown(
	markdown: string,
	language = "md",
): JSONContent {
	return {
		type: "doc",
		content: [
			{
				type: "codeBlock",
				attrs: { language },
				content: markdown.length > 0 ? [{ type: "text", text: markdown }] : [],
			},
		],
	};
}

export function markdownFromSourceDoc(editor: Editor) {
	return editor.state.doc.textBetween(
		0,
		editor.state.doc.content.size,
		"\n",
		"\n",
	);
}
