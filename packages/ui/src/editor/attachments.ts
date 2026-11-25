import type { Editor } from "@tiptap/core";

export type EditorAttachment = {
	kind: "selection" | "thread";
	path: string;
	text: string;
	source?: { from: number; to: number; text: string };
	threadId?: string;
	comments?: { author: "human" | "agent"; body: string }[];
};

export const REVEAL_ATTACHMENT = "hubble:reveal-attachment";

export function revealAttachment(editor: Editor, attachment: EditorAttachment) {
	const source = attachment.source;
	if (!source?.text || source.from < 0 || source.to < source.from) return false;
	const doc = editor.state.doc;
	let { from, to } = source;
	if (
		to > doc.content.size ||
		doc.textBetween(from, to, "\n") !== source.text
	) {
		let text = "";
		const positions: number[] = [];
		doc.descendants((node, pos) => {
			if (node.isTextblock && text) {
				text += "\n";
				positions.push(pos);
			}
			if (node.isText && node.text) {
				text += node.text;
				for (let i = 0; i < node.text.length; i++) positions.push(pos + i);
			}
		});
		const index = text.indexOf(source.text);
		// If the original range moved, only a unique text match is safe.
		if (index < 0 || text.indexOf(source.text, index + 1) >= 0) return false;
		from = positions[index];
		to = positions[index + source.text.length - 1] + 1;
	}
	editor
		.chain()
		.setTextSelection({ from, to })
		.command(({ tr }) => {
			tr.setMeta(REVEAL_ATTACHMENT, true);
			return true;
		})
		.scrollIntoView()
		.run();
	editor.view.focus();
	return true;
}
