import { VirtualCursor } from "@hubble.md/ui";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { CHAT_TEXT_LIMIT } from "../desktopApi/chat";

export function ChatComposer({
	text,
	onEdit,
	onSend,
}: {
	text: string;
	onEdit: (text: string) => void;
	onSend: () => void;
}) {
	const container = useRef<HTMLDivElement>(null);
	const [composing, setComposing] = useState(false);
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
		],
		content: documentFor(text),
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
					onSend();
					return true;
				}
				return false;
			},
			handlePaste: (view, event) => {
				const plain = event.clipboardData?.getData("text/plain");
				if (plain === undefined) return false;
				event.preventDefault();
				view.dispatch(
					view.state.tr.insertText(plain.slice(0, CHAT_TEXT_LIMIT)),
				);
				return true;
			},
		},
		onUpdate: ({ editor }) => onEdit(editor.getText({ blockSeparator: "\n" })),
	});
	useEffect(() => {
		if (editor && editor.getText({ blockSeparator: "\n" }) !== text)
			editor.commands.setContent(documentFor(text), { emitUpdate: false });
	}, [editor, text]);
	return (
		<div
			ref={container}
			onCompositionStart={() => setComposing(true)}
			onCompositionEnd={() => setComposing(false)}
			className={`relative min-h-16 max-h-[min(40vh,20rem)] overflow-x-hidden overflow-y-auto py-1 leading-relaxed ${composing ? "[&_.tiptap]:caret-brand-accent" : ""}`}
		>
			{!text ? (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute text-muted-foreground"
				>
					Let's discuss...
				</span>
			) : null}
			<EditorContent editor={editor} />
			<VirtualCursor
				editor={editor}
				containerRef={container}
				viewportRef={container}
				modeOverride={composing ? "hidden" : undefined}
			/>
		</div>
	);
}
function documentFor(text: string) {
	return {
		type: "doc",
		content: text.split("\n").map((line) => ({
			type: "paragraph",
			...(line ? { content: [{ type: "text", text: line }] } : {}),
		})),
	};
}
