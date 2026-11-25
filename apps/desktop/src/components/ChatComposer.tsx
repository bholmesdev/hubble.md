import { VirtualCursor } from "@hubble.md/ui";
import { type JSONContent, Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import {
	EditorContent,
	type NodeViewProps,
	NodeViewWrapper,
	ReactNodeViewRenderer,
	useEditor,
	useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { CHAT_CONTEXT_LIMIT, type ChatAttachment } from "../desktopApi/chat";
import { transcriptParts } from "../desktopApi/chatTranscript";
import { QuotePill } from "./ChatTranscript";

export function ChatComposer({
	text,
	attachments,
	onEdit,
	onReveal,
	onSend,
	readOnly,
	placeholder,
	promptRef,
}: {
	text: string;
	attachments: ChatAttachment[];
	onEdit: (text: string, attachments: ChatAttachment[]) => void;
	onReveal: (attachment: ChatAttachment) => void;
	onSend?: () => void;
	readOnly?: boolean;
	placeholder?: string;
	promptRef?: Ref<{ focus: () => void }>;
}) {
	const container = useRef<HTMLDivElement>(null);
	const [composing, setComposing] = useState(false);
	const callbacks = useRef({ onEdit, onReveal, onSend, attachments });
	useEffect(() => {
		callbacks.current = { onEdit, onReveal, onSend, attachments };
	});
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
				heading: false,
				horizontalRule: false,
				italic: false,
				link: false,
				listItem: false,
				listKeymap: false,
				orderedList: false,
				strike: false,
				underline: false,
			}),
			Node.create({
				name: "quote",
				inline: true,
				group: "inline",
				atom: true,
				addProseMirrorPlugins: () => [
					new Plugin({
						filterTransaction: (tr) =>
							!tr.docChanged ||
							readDraft(tr.doc.toJSON(), []).text.length <= CHAT_CONTEXT_LIMIT,
					}),
				],
				addAttributes: () => ({
					id: { default: "" },
					attachment: { default: null },
				}),
				parseHTML: () => [{ tag: "span[data-quote-id]" }],
				renderHTML: ({ node }) => ["span", { "data-quote-id": node.attrs.id }],
				addNodeView: () =>
					ReactNodeViewRenderer((props) => (
						<QuoteView
							{...props}
							onReveal={(a) => callbacks.current.onReveal(a)}
						/>
					)),
			}),
		],
		content: draftDocument(text, attachments),
		editorProps: {
			attributes: {
				role: "textbox",
				"aria-label": "Message Chat",
				"aria-multiline": "true",
				class:
					"min-h-16 outline-hidden whitespace-pre-wrap break-words [caret-color:transparent] [&_p]:m-0",
			},
			handleKeyDown: (view, event) => {
				if (
					event.key === "Enter" &&
					!event.shiftKey &&
					!event.isComposing &&
					!view.composing
				) {
					event.preventDefault();
					callbacks.current.onSend?.();
					return true;
				}
				return false;
			},
			handlePaste: (view, event) => {
				const plain = event.clipboardData?.getData("text/plain");
				if (plain === undefined) return false;
				event.preventDefault();
				view.dispatch(view.state.tr.insertText(plain));
				return true;
			},
		},
		onUpdate: ({ editor }) => {
			const draft = readDraft(editor.getJSON(), callbacks.current.attachments);
			callbacks.current.onEdit(draft.text, draft.attachments);
		},
	});
	useImperativeHandle(
		promptRef,
		() => ({
			focus: () => {
				editor?.commands.focus("end");
			},
		}),
		[editor],
	);
	useEffect(() => {
		if (!editor) return;
		let cancelled = false;
		// Node views render synchronously, so apply recognition updates after React commits.
		queueMicrotask(() => {
			if (cancelled || editor.isDestroyed) return;
			editor.setEditable(!readOnly, false);
			const current = readDraft(editor.getJSON(), attachments);
			const next = draftDocument(text, attachments);
			if (
				current.text !== text ||
				JSON.stringify(current.attachments) !==
					JSON.stringify(readDraft(next, attachments).attachments)
			) {
				const added = attachments.some(
					(a) =>
						a.offset !== undefined &&
						!current.attachments.some((previous) => previous.id === a.id),
				);
				const document = editor.schema.nodeFromJSON(
					current.text === text
						? draftQuotes(editor.getJSON(), attachments)
						: draftText(editor.state.doc, current.text, text, attachments),
				);
				const start = editor.state.doc.content.findDiffStart(document.content);
				const end = editor.state.doc.content.findDiffEnd(document.content);
				if (start !== null && end) {
					// Keep unchanged text outside the replacement so existing undo steps still map to it.
					const overlap = Math.max(0, start - Math.min(end.a, end.b));
					editor.view.dispatch(
						editor.state.tr
							.replace(
								start,
								end.a + overlap,
								document.slice(start, end.b + overlap),
							)
							.setMeta("addToHistory", false)
							.setMeta("preventUpdate", true),
					);
				}
				if (added && !readOnly) editor.commands.focus("end");
			}
		});
		return () => {
			cancelled = true;
		};
	}, [editor, text, attachments, readOnly]);

	// Cloned pill padding needs a gutter beyond the line box to avoid horizontal overflow.
	return (
		<div
			ref={container}
			onCompositionStart={() => setComposing(true)}
			onCompositionEnd={() => setComposing(false)}
			className={`relative min-h-16 max-h-[min(40vh,20rem)] overflow-x-hidden overflow-y-auto py-1 pe-2 leading-relaxed ${composing ? "[&_.tiptap]:caret-brand-accent" : ""}`}
		>
			{!text && !attachments.some((a) => a.offset !== undefined) ? (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute text-muted-foreground"
				>
					{placeholder}
				</span>
			) : null}
			<EditorContent editor={editor} />
			<VirtualCursor
				editor={editor}
				containerRef={container}
				viewportRef={container}
				modeOverride={readOnly || composing ? "hidden" : undefined}
			/>
		</div>
	);
}

function QuoteView({
	node,
	editor,
	getPos,
	onReveal,
}: NodeViewProps & { onReveal: (attachment: ChatAttachment) => void }) {
	const spacing = useEditorState({
		editor,
		selector: ({ editor }) => {
			const pos = getPos();
			if (typeof pos !== "number") return { before: false, after: false };
			return {
				before: !/\s$/.test(
					editor.state.doc.textBetween(Math.max(0, pos - 1), pos),
				),
				after: !/^\s/.test(
					editor.state.doc.textBetween(
						pos + node.nodeSize,
						Math.min(editor.state.doc.content.size, pos + node.nodeSize + 1),
					),
				),
			};
		},
	});
	const attachment = node.attrs.attachment as ChatAttachment;
	return (
		<NodeViewWrapper as="span" className="inline" contentEditable={false}>
			{spacing.before ? <span className="whitespace-normal"> </span> : null}
			{attachment ? (
				<QuotePill
					attachment={attachment}
					onReveal={onReveal}
					onRemove={() => {
						const pos = getPos();
						if (typeof pos === "number")
							editor
								.chain()
								.deleteRange({ from: pos, to: pos + node.nodeSize })
								.setTextSelection(pos)
								.focus()
								.run();
					}}
				/>
			) : null}
			{spacing.after ? <span className="whitespace-normal"> </span> : null}
		</NodeViewWrapper>
	);
}

/** Keep typed paragraph and hard-break nodes intact when only quote context changes. */
function draftQuotes(
	doc: JSONContent,
	attachments: ChatAttachment[],
	previousDoc = doc,
): JSONContent {
	const quotes = attachments
		.filter((attachment) => attachment.offset !== undefined)
		.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
	let offset = 0;
	let index = 0;
	let paragraphs = 0;
	const previous = new Map<string, JSONContent>();
	function collect(node: JSONContent) {
		if (node.type === "quote") previous.set(node.attrs?.id, node);
		for (const child of node.content ?? []) collect(child);
	}
	collect(previousDoc);
	function insert(content: JSONContent[]) {
		while (index < quotes.length && (quotes[index].offset ?? 0) <= offset) {
			const attachment = quotes[index++];
			const old = previous.get(attachment.id);
			content.push({
				type: "quote",
				attrs: {
					id: attachment.id,
					attachment: old
						? { ...attachment, offset: old.attrs?.attachment?.offset }
						: attachment,
				},
			});
		}
	}
	function visit(node: JSONContent): JSONContent {
		if (node.type === "paragraph") {
			if (paragraphs > 0) offset++;
			paragraphs++;
		}
		const content: JSONContent[] = [];
		for (const child of node.content ?? []) {
			if (child.type === "quote") continue;
			if (child.type === "text") {
				for (const character of (child.text ?? "").split("")) {
					insert(content);
					const last = content[content.length - 1];
					if (last?.type === "text") last.text += character;
					else content.push({ ...child, text: character });
					offset++;
				}
			} else {
				if (child.type === "hardBreak") {
					insert(content);
					offset++;
				}
				content.push(visit(child));
			}
		}
		if (node.type === "paragraph") insert(content);
		return node.content || content.length ? { ...node, content } : node;
	}
	return visit(doc);
}

/** Apply recognition changes without flattening unchanged typed line breaks or paragraphs. */
function draftText(
	doc: ProseMirrorNode,
	before: string,
	after: string,
	attachments: ChatAttachment[],
) {
	let start = 0;
	while (
		start < Math.min(before.length, after.length) &&
		before[start] === after[start]
	)
		start++;
	let end = before.length;
	let nextEnd = after.length;
	while (
		end > start &&
		nextEnd > start &&
		before[end - 1] === after[nextEnd - 1]
	) {
		end--;
		nextEnd--;
	}
	const plain = doc.type.schema.nodeFromJSON(draftQuotes(doc.toJSON(), []));
	const content = after
		.slice(start, nextEnd)
		.split("\n")
		.flatMap((line, index) => [
			...(index ? [doc.type.schema.nodes.hardBreak.create()] : []),
			...(line ? [doc.type.schema.text(line)] : []),
		]);
	const updated = new Transform(plain).replaceWith(
		textPosition(plain, start),
		textPosition(plain, end),
		content,
	).doc;
	return draftQuotes(updated.toJSON(), attachments, doc.toJSON());
}

function textPosition(doc: ProseMirrorNode, target: number) {
	let offset = 0;
	let blocks = 0;
	let position: number | undefined;
	doc.descendants((node, at) => {
		if (position !== undefined) return false;
		if (node.isTextblock) {
			if (blocks > 0) offset++;
			blocks++;
			if (target === offset) position = at + 1;
		} else if (node.isText) {
			if (target <= offset + node.nodeSize) position = at + target - offset;
			offset += node.nodeSize;
		} else if (node.type.name === "hardBreak") {
			if (target === offset) position = at;
			offset++;
		}
		return position === undefined;
	});
	return position ?? doc.content.size - 1;
}

function draftDocument(
	text: string,
	attachments: ChatAttachment[],
): JSONContent {
	const content: JSONContent[] = [];
	for (const part of transcriptParts(text, attachments)) {
		if (part.text) content.push({ type: "text", text: part.text });
		if (part.attachment)
			content.push({
				type: "quote",
				attrs: { id: part.attachment.id, attachment: part.attachment },
			});
	}
	return { type: "doc", content: [{ type: "paragraph", content }] };
}

function readDraft(doc: JSONContent, attachments: ChatAttachment[]) {
	let text = "";
	const quotes: ChatAttachment[] = [];
	function read(node: JSONContent) {
		if (node.type === "text") text += node.text ?? "";
		else if (node.type === "hardBreak") text += "\n";
		else if (node.type === "quote") {
			const attachment = node.attrs?.attachment as ChatAttachment | undefined;
			if (attachment) quotes.push({ ...attachment, offset: text.length });
		} else {
			for (const [index, child] of (node.content ?? []).entries()) {
				if (index && child.type === "paragraph") text += "\n";
				read(child);
			}
		}
	}
	read(doc);
	return {
		text,
		attachments: [
			...attachments.filter((a) => a.offset === undefined),
			...quotes,
		],
	};
}
