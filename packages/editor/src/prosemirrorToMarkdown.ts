import type { JSONContent } from "@tiptap/core";
import type { Fragment } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import type { LinkAttrs } from "./Link";
import { wikiDisplayNameForTarget } from "./markdownPath";
import { serializeReviewMetadata } from "./ReviewMark";
import { escapeReviewBody, escapeReviewContent } from "./reviewEscaping";

/**
 * Convert TipTap JSONContent (ProseMirror document) -> Markdown string
 * This is the reverse of remark-to-prosemirror.ts and runs synchronously.
 */
export function tiptapDocToMarkdown(doc: JSONContent): string {
	if (doc.type !== "doc" || !doc.content) {
		return "";
	}

	const blocks = doc.content.map(blockToMarkdown);
	return blocks.join("\n\n");
}

export function selectionToMarkdown(selection: Selection): string {
	return fragmentToMarkdown(selection.content().content);
}

function fragmentToMarkdown(fragment: Fragment): string {
	const content = fragment.toJSON();
	if (!Array.isArray(content)) return "";
	return tiptapDocToMarkdown({ type: "doc", content });
}

function blockToMarkdown(node: JSONContent): string {
	if (!node.type) return "";

	switch (node.type) {
		case "paragraph": {
			const content = inlineToMarkdown(node.content ?? []);
			// Empty paragraphs should produce a blank line
			return content || "";
		}

		case "heading": {
			const level = node.attrs?.level ?? 1;
			const content = inlineToMarkdown(node.content ?? []);
			const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
			return `${hashes} ${content}`;
		}

		case "blockquote": {
			const blockContent = (node.content ?? [])
				.map(blockToMarkdown)
				.filter(Boolean)
				.join("\n\n");
			// Add '> ' prefix to each line
			return blockContent
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n");
		}

		case "codeBlock": {
			const content =
				node.content
					?.map((child) => (child.type === "text" ? (child.text ?? "") : ""))
					.join("") ?? "";
			const language =
				typeof node.attrs?.language === "string" ? node.attrs.language : "";
			return `\`\`\`${language}\n${content}\n\`\`\``;
		}

		case "horizontalRule": {
			return "---";
		}

		case "orderedList": {
			const start = node.attrs?.start ?? 1;
			return (node.content ?? [])
				.map((item, index) => listItemToMarkdown(item, start + index))
				.filter(Boolean)
				.join("\n");
		}

		case "bulletList": {
			return (node.content ?? [])
				.map((item) => listItemToMarkdown(item))
				.filter(Boolean)
				.join("\n");
		}

		case "image": {
			const src = node.attrs?.src ?? "";
			const alt = node.attrs?.alt ?? "";
			if (!src || node.attrs?.uploadId) return "";

			return `![${alt}](${src})`;
		}

		case "embed": {
			const src = String(node.attrs?.src ?? "");
			if (!isValidIframeEmbedSrc(src)) return "";
			return `<iframe src="${escapeHtmlAttr(src)}"></iframe>`;
		}

		case "table": {
			const rows = (node.content ?? []).map((row, index) => {
				const rowText = blockToMarkdown(row);
				if (index === 0) {
					const cellCount = row.content?.length ?? 1;
					const separator = `|${Array(cellCount).fill("---").join("|")}|`;
					return `${rowText}\n${separator}`;
				}
				return rowText;
			});
			return rows.join("\n");
		}

		case "tableRow": {
			const cells = (node.content ?? []).map(blockToMarkdown);
			return `| ${cells.join(" | ")} |`;
		}

		case "tableCell":
		case "tableHeader": {
			const cellContent = (node.content ?? [])
				.map(blockToMarkdown)
				.join("<br>")
				.replace(/ {2}\n/g, "<br>");
			return cellContent.replace(/\|/g, "\\|");
		}

		default:
			return "";
	}
}

const BLOCKED_IFRAME_SCHEME = /^(file:|data:|javascript:|hubble-asset:)/i;
const LOCAL_IFRAME_SRC = /^(\.{1,2}\/|[^:/\\]+(?:\/|$)).*\.html(?:[?#].*)?$/i;

function isValidIframeEmbedSrc(src: string): boolean {
	if (!src.trim()) return false;
	if (BLOCKED_IFRAME_SCHEME.test(src)) {
		return false;
	}
	if (src.startsWith("/") || src.startsWith("\\") || src.startsWith("//")) {
		return false;
	}
	return LOCAL_IFRAME_SRC.test(src);
}

function escapeHtmlAttr(value: string) {
	return value
		.split("&")
		.join("&amp;")
		.split('"')
		.join("&quot;")
		.split("<")
		.join("&lt;");
}

function getLinkAttrs(node: JSONContent | undefined): LinkAttrs | null {
	if (!node?.marks) return null;
	const linkMark = node.marks.find((mark) => mark.type === "link");
	if (!linkMark) return null;
	const attrs = linkMark.attrs as
		| { href?: unknown; kind?: unknown; target?: unknown }
		| undefined;
	if (typeof attrs?.href !== "string") return null;
	return {
		href: attrs.href,
		kind: attrs.kind === "wiki" ? "wiki" : "url",
		target: typeof attrs.target === "string" ? attrs.target : null,
	};
}

function linkKey(attrs: LinkAttrs | null) {
	if (!attrs) return null;
	return `${attrs.kind}\u0000${attrs.href}\u0000${attrs.target ?? ""}`;
}

function removeLinkMark(node: JSONContent): JSONContent {
	if (!node.marks) return node;
	return {
		...node,
		marks: node.marks.filter((mark) => mark.type !== "link"),
	};
}

function listItemToMarkdown(item: JSONContent, number?: number): string {
	if (item.type !== "listItem") return "";

	const isBullet = number === undefined;
	const content = (item.content ?? [])
		.map((node, index) => {
			if (index === 0 && node.type === "paragraph") {
				// First paragraph content goes inline with the bullet/number or checkbox
				return inlineToMarkdown(node.content ?? []);
			}
			// Additional blocks are indented
			return blockToMarkdown(node)
				.split("\n")
				.map((line) => `  ${line}`)
				.join("\n");
		})
		.filter(Boolean)
		.join("\n");

	// If this is a bullet item and it has a checked attribute (true/false), render as a task item
	const hasCheckedAttr = item.attrs && "checked" in item.attrs;
	const checked = hasCheckedAttr ? item.attrs?.checked : null;

	if (isBullet && checked !== null && checked !== undefined) {
		const checkbox = checked ? "[x]" : "[ ]";
		return `- ${checkbox} ${content}`;
	}

	const prefix = isBullet ? "-" : `${number}.`;
	return `${prefix} ${content}`;
}

function inlineToMarkdown(nodes: JSONContent[]): string {
	const normalizedNodes = normalizeInlineMarkWhitespace(nodes);
	return inlineNodesToMarkdown(normalizedNodes);
}

function inlineNodesToMarkdown(nodes: JSONContent[]): string {
	let result = "";
	for (let i = 0; i < nodes.length; ) {
		const mark = getReviewMark(nodes[i]);
		if (mark) {
			let j = i;
			const grouped: JSONContent[] = [];
			while (j < nodes.length) {
				const nextReviewMark = getReviewMark(nodes[j]);
				if (!nextReviewMark || !isSameMark(nextReviewMark, mark)) break;
				grouped.push(removeMark(nodes[j], mark));
				j += 1;
			}
			const content = escapeReviewContent(inlineNodesToMarkdown(grouped));
			const type = mark.attrs?.type;
			if (type === "reviewReplacement") {
				result += `{~~${escapeReviewContent(mark.attrs?.original)}~>${content}~~}`;
			} else if (type === "reviewComment") {
				result += `{==${content}==}{>>${escapeReviewBody(mark.attrs?.body)}<<}`;
			} else if (type === "reviewInsertion") {
				result += `{++${content}++}`;
			} else if (type === "reviewDeletion") {
				result += `{--${content}--}`;
			} else {
				result += `{==${content}==}`;
			}
			if (mark.attrs?.id) result += `{#${mark.attrs.id}}`;
			if (type === "reviewComment") {
				result += serializeReviewMetadata(mark.attrs ?? {});
			}
			i = j;
			continue;
		}

		const node = nodes[i];
		const delimitedMark = getDelimitedMark(node, nodes[i + 1]);
		if (delimitedMark) {
			let j = i;
			const grouped: JSONContent[] = [];
			while (j < nodes.length && hasMark(nodes[j].marks ?? [], delimitedMark)) {
				grouped.push(removeMark(nodes[j], delimitedMark));
				j += 1;
			}
			const delimiter = delimiterForMark(delimitedMark);
			result += `${delimiter}${inlineNodesToMarkdown(grouped)}${delimiter}`;
			i = j;
			continue;
		}

		const attrs = getLinkAttrs(node);
		const key = linkKey(attrs);
		if (!attrs || !key) {
			result += nodeToMarkdown(node);
			i += 1;
			continue;
		}

		let j = i;
		const grouped: JSONContent[] = [];
		while (j < nodes.length && linkKey(getLinkAttrs(nodes[j])) === key) {
			grouped.push(removeLinkMark(nodes[j]));
			j += 1;
		}
		const text = inlineNodesToMarkdown(grouped);
		if (attrs.kind === "wiki") {
			const target = attrs.target || attrs.href;
			const defaultText = wikiDisplayNameForTarget(target);
			result +=
				text === defaultText
					? `[[${target}]]`
					: `[[${target}|${escapeWikiAlias(text)}]]`;
		} else {
			result += `[${text}](${attrs.href})`;
		}
		i = j;
	}
	return result;
}

function getReviewMark(node: JSONContent | undefined) {
	return (
		node?.marks?.find((candidate) => candidate.type === "reviewMark") ?? null
	);
}

const BOUNDARY_SENSITIVE_MARKS = new Set(["bold", "italic", "strike", "link"]);
const DELIMITED_MARK_ORDER = ["bold", "italic", "strike"] as const;
type DelimitedMarkType = (typeof DELIMITED_MARK_ORDER)[number];
type Mark = NonNullable<JSONContent["marks"]>[number];

function getDelimitedMark(
	node: JSONContent | undefined,
	nextNode: JSONContent | undefined,
) {
	const marks = node?.marks ?? [];
	const nextMarks = nextNode?.marks ?? [];
	const continuingType = DELIMITED_MARK_ORDER.find(
		(markType) =>
			marks.some((mark) => mark.type === markType) &&
			nextMarks.some((mark) => mark.type === markType),
	);
	const type =
		continuingType ??
		DELIMITED_MARK_ORDER.find((markType) =>
			marks.some((mark) => mark.type === markType),
		);
	return type ? marks.find((mark) => mark.type === type) : null;
}

function delimiterForMark(mark: Mark) {
	switch (mark.type as DelimitedMarkType) {
		case "bold":
			return "**";
		case "italic":
			return "*";
		case "strike":
			return "~~";
	}
}

function removeMark(node: JSONContent, mark: Mark): JSONContent {
	if (!node.marks) return node;
	return {
		...node,
		marks: node.marks.filter((candidate) => !isSameMark(candidate, mark)),
	};
}

// Markdown rejects emphasis delimiters that touch whitespace on the inside:
// `**bold **next` does not parse as bold. Before serializing, split each
// marked text node's leading/trailing whitespace into its own node and drop
// the emphasis marks from it, so bold("bold ") + "next" emits "**bold** next".
// Whitespace between two nodes sharing a mark keeps that mark, so
// bold("a ") + bold("b") still emits "**a b**".
function normalizeInlineMarkWhitespace(nodes: JSONContent[]) {
	return nodes.flatMap((node, index) => {
		if (node.type !== "text" || !node.text || !node.marks?.length) {
			return [node];
		}

		// Skip code spans: whitespace inside backticks is part of the code, and
		// `code("foo ")` must emit "`foo `", not "`foo` ".
		if (node.marks.some((mark) => mark.type === "code")) {
			return [node];
		}

		const prevMarks = nodes[index - 1]?.marks ?? [];
		const nextMarks = nodes[index + 1]?.marks ?? [];

		// A node that is nothing but whitespace has no content to keep a
		// delimiter attached to. Keep a mark only if both neighbors have it too
		// (interior gap, stays inside the run: bold("a") + bold(" ") + bold("b")
		// emits "**a b**"). Otherwise drop it, or bold("a") + bold("   ") would
		// emit invalid "**a   **".
		if (/^[ \t]+$/.test(node.text)) {
			return [
				{
					...node,
					marks: boundaryMarks(boundaryMarks(node.marks, prevMarks), nextMarks),
				},
			];
		}

		const leadingWhitespace = node.text.match(/^[ \t]+/)?.[0] ?? "";
		const trailingWhitespace = node.text.match(/[ \t]+$/)?.[0] ?? "";
		let text = node.text;
		const parts: JSONContent[] = [];

		if (leadingWhitespace && leadingWhitespace.length < text.length) {
			parts.push({
				...node,
				text: leadingWhitespace,
				marks: boundaryMarks(node.marks, prevMarks),
			});
			text = text.slice(leadingWhitespace.length);
		}

		const trailingLength =
			trailingWhitespace && trailingWhitespace.length < text.length
				? trailingWhitespace.length
				: 0;
		const content = trailingLength ? text.slice(0, -trailingLength) : text;
		if (content) {
			parts.push({ ...node, text: content });
		}

		if (trailingLength) {
			parts.push({
				...node,
				text: text.slice(-trailingLength),
				marks: boundaryMarks(node.marks, nextMarks),
			});
		}

		return parts;
	});
}

function boundaryMarks(
	currentMarks: NonNullable<JSONContent["marks"]>,
	neighborMarks: NonNullable<JSONContent["marks"]>,
) {
	return currentMarks.filter(
		(mark) =>
			!BOUNDARY_SENSITIVE_MARKS.has(mark.type ?? "") ||
			hasMark(neighborMarks, mark),
	);
}

function hasMark(marks: NonNullable<JSONContent["marks"]>, mark: Mark) {
	return marks.some((candidate) => isSameMark(candidate, mark));
}

function isSameMark(left: Mark, right: Mark) {
	return (
		left.type === right.type &&
		JSON.stringify(left.attrs ?? null) === JSON.stringify(right.attrs ?? null)
	);
}

function escapeWikiAlias(alias: string) {
	return alias.split("|").join("\\|");
}

function nodeToMarkdown(node: JSONContent): string {
	if (!node.type) return "";

	switch (node.type) {
		case "text": {
			let text = node.text ?? "";

			// Apply marks in the correct order for Markdown
			const marks = node.marks ?? [];

			for (const mark of marks) {
				switch (mark.type) {
					case "code":
						text = `\`${text}\``;
						break;
					case "link":
						break;
				}
			}

			return text;
		}

		case "hardBreak": {
			return "  \n"; // Two spaces + newline creates a line break in Markdown
		}

		default:
			return "";
	}
}
