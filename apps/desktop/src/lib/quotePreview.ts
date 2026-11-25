import { markdownToTiptapDoc } from "@hubble.md/editor";
import type { JSONContent } from "@tiptap/core";

export function quotePreview(markdown: string) {
	return paragraphText(markdownToTiptapDoc(markdown))
		.replace(/\s+/g, " ")
		.trim();
}

function paragraphText(node: JSONContent): string {
	if (node.text) return node.text;
	if (node.type === "hardBreak") return " ";
	if (node.type === "image") return String(node.attrs?.alt ?? "");
	const separator = ["paragraph", "heading", "codeBlock"].includes(
		node.type ?? "",
	)
		? ""
		: " ";
	return (node.content ?? []).map(paragraphText).join(separator);
}

export function shortQuote(text: string) {
	const characters = Array.from(text);
	return characters.length > 20 ? `${characters.slice(0, 20).join("")}…` : text;
}
