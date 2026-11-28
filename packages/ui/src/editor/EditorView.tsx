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
	tiptapDocToMarkdown,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { closeHistory } from "@tiptap/pm/history";
import {
	EditorContent,
	type EditorOptions,
	type JSONContent,
	useEditor,
} from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clearActiveEditor, setActiveEditor } from "./activeEditor";
import { CODE_BLOCK_COPY_EVENT, HubbleCodeBlock } from "./CodeBlockExtension";
import { copySelectionAsMarkdown } from "./copyAsMarkdown";
import { EmptyBlockDirectionExtension } from "./EmptyBlockDirectionExtension";
import { LinkClickExtension } from "./LinkClickExtension";
import { LinkCreationGhostExtension } from "./LinkCreationGhostExtension";
import { LinkPopover, type WikiTarget } from "./LinkPopover";
import {
	flushPendingSave,
	type PendingSave,
	schedulePendingSave,
} from "./pendingSave";
import { replaceEditorContent } from "./replaceEditorContent";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { SmartLinkExtension } from "./SmartLinkExtension";
import { TableCellSelectionExtension } from "./TableCellSelectionExtension";
import {
	MarkdownTableCell,
	MarkdownTableHeader,
} from "./TableMarkdownExtensions";
import { ToolEditHighlight } from "./ToolEditHighlight";
import { VirtualCursor } from "./VirtualCursor";
import "./EditorView.css";
import {
	EditorCommandShortcuts,
	starterKitWithRegistryShortcuts,
} from "./EditorCommandShortcuts";
import {
	FilePropertiesPanel,
	frontMatterStateFromMarkdown,
} from "./FilePropertiesPanel";
import { FindBar } from "./FindBar";
import { FormatCommandMenu } from "./FormatCommandMenu";
import {
	FormattingStatusBar,
	type SpellcheckStatus,
} from "./FormattingStatusBar";
import {
	FrontMatterHistory,
	FrontMatterStep,
	readFrontMatter,
} from "./frontMatterHistory";
import {
	type ReviewCommentHandle,
	ReviewCommentPopover,
} from "./ReviewCommentPopover";
import type { ReviewThread } from "./reviewComments";
import { SelectionFormattingToolbar } from "./SelectionFormattingToolbar";
import type { VirtualCursorMode } from "./virtualCursorMode";

const DEFAULT_SAVE_DEBOUNCE_MS = 120;

export type { WikiTarget };

export type EditorViewProps = {
	path: string;
	/** Stable note identity; physical paths may change without replacing a note. */
	documentId?: string;
	/** Keep undo history when the same note receives rewritten Markdown. */
	preserveHistoryOnUpdate?: boolean;
	undoableUpdate?: string;
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
	/** Footer status for non-default spellcheck languages. Desktop-only. */
	spellcheckStatus?: SpellcheckStatus | null;
};

export function EditorView({
	path,
	documentId = path,
	preserveHistoryOnUpdate = false,
	undoableUpdate,
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
	spellcheckStatus,
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
	const reviewCommentRef = useRef<ReviewCommentHandle | null>(null);
	const [frontMatterState, setFrontMatterState] = useState(() =>
		frontMatterStateFromMarkdown(initialMarkdown),
	);
	const frontMatterStateRef = useRef(frontMatterState);
	const pathRef = useRef(path);
	const updateRef = useRef(undoableUpdate);
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
	const [initialMetadata] = useState(() => ({
		raw: initialFrontMatterRaw,
		properties: frontMatterState,
	}));

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
		textDirection: "auto",
		extensions: [
			ToolEditHighlight,
			FrontMatterHistory.configure({ initial: initialMetadata }),
			...starterKitWithRegistryShortcuts({
				code: false,
				codeBlock: false,
				listItem: false,
			}),
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
			EmptyBlockDirectionExtension,
			FakeSelectionExtension,
			FindExtension,
			HeadingExtension,
			MarkdownRolloverExtension,
			ReviewMarkExtension,
			EditorCommandShortcuts,
			...listExtensions,
			...extensions,
			TaskItem.configure({ nested: true }),
			Table.configure({ resizable: true }),
			TableRow,
			MarkdownTableHeader,
			MarkdownTableCell,
			TableCellSelectionExtension,
		],
		content: initialDoc,
		// Metadata steps leave the body unchanged, so TipTap skips its update event.
		onTransaction: ({ editor: current, transaction }) => {
			if (!transaction.docChanged || transaction.getMeta("preventUpdate"))
				return;
			const doc = current.getJSON() as JSONContent;
			if (hasUploadImage(doc)) return;
			const body = tiptapDocToMarkdown(doc);
			const metadata = readFrontMatter(current.state);
			const metadataChanged = transaction.steps.some(
				(step) => step instanceof FrontMatterStep,
			);
			// Body edits must retain a property-name draft that has not been committed yet.
			const frontMatter = metadataChanged
				? metadata.raw
				: partsRef.current.frontMatter;
			partsRef.current = { body, frontMatter };
			const markdown = combineMarkdownFrontMatter(
				partsRef.current.frontMatter,
				body,
			);
			latestMarkdownRef.current = markdown;
			const properties = metadata.properties;
			if (metadataChanged) {
				frontMatterStateRef.current = properties;
				setFrontMatterState(properties);
			}
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
		setActiveEditor(editor);
		return () => clearActiveEditor(editor);
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
		const undoable = Boolean(
			undoableUpdate && updateRef.current !== undoableUpdate,
		);
		updateRef.current = undoableUpdate;
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
		const currentBody = tiptapDocToMarkdown(editor.getJSON() as JSONContent);
		if (
			currentBody !== parsed.body ||
			readFrontMatter(editor.state).raw !== frontMatter
		) {
			const properties = frontMatterStateFromMarkdown(
				initialMarkdown,
				frontMatterStateRef.current,
			);
			frontMatterStateRef.current = properties;
			setFrontMatterState(properties);
			replaceEditorContent(
				editor,
				markdownToTiptapDoc(parsed.body),
				undoable,
				preserveHistoryOnUpdate,
				(tr) => {
					tr.step(
						new FrontMatterStep(readFrontMatter(editor.state), {
							raw: frontMatter,
							properties,
						}),
					);
				},
			);
		}
	}, [editor, initialMarkdown, preserveHistoryOnUpdate, undoableUpdate]);

	useEffect(() => {
		// One editor instance can serve every file, so each new document starts its own
		// undo stack. Otherwise undo replays the last file's edits into this one.
		void documentId;
		if (!editor) return;
		resetEditorHistory(editor);
	}, [editor, documentId]);

	useEffect(() => {
		// Flush the pending edit before the next document takes over.
		void documentId;
		return () => {
			flushPendingSave(pendingSaveRef);
		};
	}, [documentId]);

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
						state={frontMatterState}
						committedState={
							editor
								? readFrontMatter(editor.state).properties
								: frontMatterState
						}
						onDraftChange={(nextState, frontMatter) => {
							partsRef.current = { ...partsRef.current, frontMatter };
							frontMatterStateRef.current = nextState;
							setFrontMatterState(nextState);
							// Keyboard navigation can unmount a focused field without a blur.
							// Publish its text now; commit one history step when editing ends.
							latestMarkdownRef.current = combineMarkdownFrontMatter(
								frontMatter,
								partsRef.current.body,
							);
							onLocalChange(pathRef.current, latestMarkdownRef.current);
							scheduleSave();
						}}
						onChange={(nextState, frontMatter) => {
							// Row IDs and unfinished drafts must travel with history; YAML cannot retain them.
							frontMatterStateRef.current = nextState;
							setFrontMatterState(nextState);
							partsRef.current = { ...partsRef.current, frontMatter };
							if (editor) editor.view.dispatch(closeHistory(editor.state.tr));
							editor?.commands.command(({ tr, state }) => {
								tr.step(
									new FrontMatterStep(readFrontMatter(state), {
										raw: frontMatter,
										properties: nextState,
									}),
								);
								return true;
							});
							if (editor) editor.view.dispatch(closeHistory(editor.state.tr));
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
							viewport={editorViewportEl}
							onComment={() => reviewCommentRef.current?.addComment()}
						/>
						<ReviewCommentPopover
							editor={editor}
							filePath={path}
							viewportRef={editorViewportRef}
							ref={reviewCommentRef}
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
			<FormattingStatusBar
				editor={editor}
				scrollContainer={editorViewportEl}
				spellcheckStatus={spellcheckStatus}
			/>
		</div>
	);
}

function hasUploadImage(node: JSONContent): boolean {
	if (node.type === "image" && node.attrs?.uploadId) return true;
	return node.content?.some(hasUploadImage) ?? false;
}
