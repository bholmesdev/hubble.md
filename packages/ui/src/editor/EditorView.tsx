import {
	ContextMenuSpellcheckExtension,
	combineMarkdownFrontMatter,
	FakeSelectionExtension,
	FindExtension,
	HeadingExtension,
	InlineCodeExtension,
	LinkExtension,
	listExtensions,
	MarkdownRolloverExtension,
	markdownToTiptapDoc,
	parseMarkdownFrontMatter,
	ReviewMarkExtension,
	RichTextClipboardExtension,
	resetEditorHistory,
	StrikethroughShortcutExtension,
	tiptapDocToMarkdown,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import {
	EditorContent,
	type EditorOptions,
	type JSONContent,
	useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CODE_BLOCK_COPY_EVENT, HubbleCodeBlock } from "./CodeBlockExtension";
import { copySelectionAsMarkdown } from "./copyAsMarkdown";
import { LinkClickExtension } from "./LinkClickExtension";
import { LinkCreationGhostExtension } from "./LinkCreationGhostExtension";
import { LinkPopover, type WikiTarget } from "./LinkPopover";
import {
	flushPendingSave,
	type PendingSave,
	schedulePendingSave,
} from "./pendingSave";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { SmartLinkExtension } from "./SmartLinkExtension";
import { TableCellSelectionExtension } from "./TableCellSelectionExtension";
import { VirtualCursor } from "./VirtualCursor";
import "./EditorView.css";
import {
	FilePropertiesPanel,
	frontMatterStateFromMarkdown,
} from "./FilePropertiesPanel";
import { FindBar } from "./FindBar";
import { FormatCommandMenu } from "./FormatCommandMenu";
import { FormattingStatusBar } from "./FormattingStatusBar";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import type { ReviewThread } from "./reviewComments";
import { SelectionFormattingToolbar } from "./SelectionFormattingToolbar";
import type { VirtualCursorMode } from "./virtualCursorMode";

const DEFAULT_SAVE_DEBOUNCE_MS = 120;

// Markdown table cells should not hold block content, so cells allow exactly one
// paragraph (line breaks serialize as <br>)
const InlineTableCell = TableCell.extend({ content: "paragraph" });
const InlineTableHeader = TableHeader.extend({ content: "paragraph" });

export type { WikiTarget };

export type EditorViewProps = {
	path: string;
	initialMarkdown: string;
	editable?: boolean;
	wikiTargets?: WikiTarget[];
	extensions?: EditorOptions["extensions"];
	editorProps?: EditorOptions["editorProps"];
	onPaste?: (editor: Editor, event: ClipboardEvent) => boolean;
	onDrop?: (editor: Editor, event: DragEvent) => boolean;
	saveDebounceMs?: number;
	onLocalChange: (path: string, markdown: string) => void;
	onSave: (path: string, markdown: string) => void | Promise<void>;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
	copyAsMarkdownRequest?: number;
	onOpenExternalLink: (href: string) => void | Promise<void>;
	onOpenWikiLink: (target: string) => void | Promise<void>;
	onMessage?: (message: string, type: "success" | "error") => void;
	/** Review threads in the open document, republished on every edit, so an
	 * app can list them in its own chrome. */
	onReviewThreadsChange?: (threads: ReviewThread[]) => void;
};

export function EditorView({
	path,
	initialMarkdown,
	editable = true,
	wikiTargets = [],
	extensions = [],
	editorProps,
	onPaste,
	onDrop,
	saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
	onLocalChange,
	onSave,
	onScrollContainerChange,
	copyAsMarkdownRequest = 0,
	onOpenExternalLink,
	onOpenWikiLink,
	onMessage,
	onReviewThreadsChange,
}: EditorViewProps) {
	const initialFrontMatter = parseMarkdownFrontMatter(initialMarkdown);
	const initialFrontMatterRaw =
		initialFrontMatter.type === "none" ? "" : initialFrontMatter.raw;
	const partsRef = useRef({
		body: initialFrontMatter.body,
		frontMatter: initialFrontMatterRaw,
	});
	const latestMarkdownRef = useRef(
		combineMarkdownFrontMatter(initialFrontMatterRaw, initialFrontMatter.body),
	);
	const pendingSaveRef = useRef<PendingSave | null>(null);
	const editorRootRef = useRef<HTMLDivElement | null>(null);
	const editorViewportRef = useRef<HTMLDivElement | null>(null);
	const lastCopyAsMarkdownRequestRef = useRef(copyAsMarkdownRequest);
	const [editorViewportEl, setEditorViewportEl] =
		useState<HTMLDivElement | null>(null);
	const [cursorModeOverride, setCursorModeOverride] =
		useState<VirtualCursorMode | null>(null);
	const [reviewCommentRequest, setReviewCommentRequest] = useState(0);
	const [frontMatterState, setFrontMatterState] = useState(() =>
		frontMatterStateFromMarkdown(initialMarkdown),
	);
	const pathRef = useRef(path);
	const editorRef = useRef<Editor | null>(null);
	useLayoutEffect(() => {
		pathRef.current = path;
	}, [path]);

	const setEditorViewport = (node: HTMLDivElement | null) => {
		editorViewportRef.current = node;
		setEditorViewportEl(node);
		onScrollContainerChange?.(node);
	};

	// Only used at editor creation. Later file loads sync through setContent.
	const [initialDoc] = useState(() =>
		markdownToTiptapDoc(initialFrontMatter.body),
	);

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
		editable,
		extensions: [
			StarterKit.configure({ code: false, codeBlock: false, listItem: false }),
			InlineCodeExtension,
			HubbleCodeBlock,
			LinkExtension,
			RichTextClipboardExtension,
			SmartLinkExtension,
			LinkClickExtension.configure({
				onOpenExternalLink,
				onOpenWikiLink,
				requireModifier: editable,
			}),
			LinkCreationGhostExtension,
			ContextMenuSpellcheckExtension,
			FakeSelectionExtension,
			FindExtension,
			HeadingExtension,
			MarkdownRolloverExtension,
			ReviewMarkExtension,
			StrikethroughShortcutExtension,
			...listExtensions,
			...extensions,
			TaskItem.configure({ nested: true }),
			Table.configure({ resizable: true }),
			TableRow,
			InlineTableHeader,
			InlineTableCell,
			TableCellSelectionExtension,
		],
		content: initialDoc,
		onUpdate: ({ editor: current }) => {
			const doc = current.getJSON() as JSONContent;
			if (hasUploadImage(doc)) return;
			const body = tiptapDocToMarkdown(doc);
			partsRef.current = { ...partsRef.current, body };
			const markdown = combineMarkdownFrontMatter(
				partsRef.current.frontMatter,
				body,
			);
			latestMarkdownRef.current = markdown;
			onLocalChange(pathRef.current, markdown);
			scheduleSave();
		},
		editorProps: {
			...editorProps,
			attributes: {
				...editorProps?.attributes,
				"data-editor-input": "",
			},
			handlePaste: (view, event, slice): boolean => {
				if (editorProps?.handlePaste?.(view, event, slice)) return true;
				const currentEditor = editorRef.current;
				if (!currentEditor || !onPaste) return false;
				return onPaste(currentEditor, event);
			},
			handleDrop: (view, event, slice, moved): boolean => {
				if (editorProps?.handleDrop?.(view, event, slice, moved)) return true;
				const currentEditor = editorRef.current;
				if (!currentEditor || !onDrop) return false;
				return onDrop(currentEditor, event);
			},
		},
	});
	useLayoutEffect(() => {
		editorRef.current = editor;
	}, [editor]);

	useEffect(() => {
		if (!editor || !editorViewportEl) return;
		const focusEditorEnd = (event: MouseEvent) => {
			if (event.target !== editorViewportEl) return;
			editor.commands.focus("end");
		};
		editorViewportEl.addEventListener("mousedown", focusEditorEnd);
		return () =>
			editorViewportEl.removeEventListener("mousedown", focusEditorEnd);
	}, [editor, editorViewportEl]);

	useEffect(() => {
		if (!editor) return;
		if (initialMarkdown === latestMarkdownRef.current) {
			return;
		}
		const parsed = parseMarkdownFrontMatter(initialMarkdown);
		const frontMatter = parsed.type === "none" ? "" : parsed.raw;
		partsRef.current = { body: parsed.body, frontMatter };
		latestMarkdownRef.current = combineMarkdownFrontMatter(
			frontMatter,
			parsed.body,
		);
		setFrontMatterState(frontMatterStateFromMarkdown(initialMarkdown));
		const currentBody = tiptapDocToMarkdown(editor.getJSON() as JSONContent);
		if (currentBody !== parsed.body) {
			editor
				.chain()
				.setMeta("addToHistory", false)
				.setContent(markdownToTiptapDoc(parsed.body), { emitUpdate: false })
				.run();
			resetEditorHistory(editor);
		}
	}, [editor, initialMarkdown]);

	useEffect(() => {
		// Path changes flush the pending edit before the next document takes over.
		void path;
		return () => {
			flushPendingSave(pendingSaveRef);
		};
	}, [path]);

	useEffect(() => {
		if (!onMessage) return;
		const handleCopyMessage = (event: Event) => {
			const detail = (event as CustomEvent).detail as
				| { message?: unknown; type?: unknown }
				| undefined;
			if (typeof detail?.message !== "string") return;
			onMessage(detail.message, detail.type === "error" ? "error" : "success");
		};
		window.addEventListener(CODE_BLOCK_COPY_EVENT, handleCopyMessage);
		return () =>
			window.removeEventListener(CODE_BLOCK_COPY_EVENT, handleCopyMessage);
	}, [onMessage]);

	useEffect(() => {
		if (!editor || copyAsMarkdownRequest === 0) return;
		if (copyAsMarkdownRequest === lastCopyAsMarkdownRequestRef.current) return;
		lastCopyAsMarkdownRequestRef.current = copyAsMarkdownRequest;
		void copySelectionAsMarkdown({
			editor,
			onCopied: () => onMessage?.("Markdown copied", "success"),
		});
	}, [copyAsMarkdownRequest, editor, onMessage]);

	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			ref={editorRootRef}
			data-hubble-editor
		>
			<div
				className="editorViewport relative min-h-0 flex-1 overflow-auto overscroll-contain"
				ref={setEditorViewport}
			>
				{editable && (
					<FilePropertiesPanel
						path={path}
						state={frontMatterState}
						onChange={(nextState, frontMatter) => {
							setFrontMatterState(nextState);
							partsRef.current = { ...partsRef.current, frontMatter };
							const markdown = combineMarkdownFrontMatter(
								frontMatter,
								partsRef.current.body,
							);
							latestMarkdownRef.current = markdown;
							onLocalChange(pathRef.current, markdown);
							scheduleSave();
						}}
					/>
				)}
				<EditorContent editor={editor} />
				<VirtualCursor
					editor={editor}
					containerRef={editorRootRef}
					viewportRef={editorViewportRef}
					modeOverride={cursorModeOverride}
				/>
				{editable && (
					<>
						<LinkPopover
							editor={editor}
							containerRef={editorRootRef}
							viewportRef={editorViewportRef}
							wikiTargets={wikiTargets}
							onOpenExternalLink={onOpenExternalLink}
							onOpenWikiLink={onOpenWikiLink}
							onMessage={onMessage}
							onCursorModeChange={setCursorModeOverride}
						/>
						<SlashCommandMenu editor={editor} viewportRef={editorViewportRef} />
						<SelectionFormattingToolbar
							editor={editor}
							viewportRef={editorViewportRef}
							onComment={() => setReviewCommentRequest((value) => value + 1)}
						/>
						<ReviewCommentPopover
							editor={editor}
							filePath={path}
							viewportRef={editorViewportRef}
							request={reviewCommentRequest}
							onMessage={onMessage}
							onThreadsChange={onReviewThreadsChange}
						/>
						<FormatCommandMenu
							editor={editor}
							viewportRef={editorViewportRef}
						/>
					</>
				)}
			</div>
			<FindBar editor={editor} />
			<FormattingStatusBar editor={editor} scrollContainer={editorViewportEl} />
		</div>
	);
}

function hasUploadImage(node: JSONContent): boolean {
	if (node.type === "image" && node.attrs?.uploadId) return true;
	return node.content?.some(hasUploadImage) ?? false;
}
