import type { JSONContent } from "@tiptap/core";
import type {
	Element as HastElement,
	Root as HastRoot,
	RootContent,
} from "hast";
import { fromHtml } from "hast-util-from-html";
import type { Content, Image, List, ListItem, Paragraph, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type Plugin, unified } from "unified";
import { visit } from "unist-util-visit";
import { wikiDisplayNameForTarget } from "./markdownPath";
import { parseReviewMetadata } from "./ReviewMark";
import { unescapeReviewText } from "./reviewEscaping";

// Convert Markdown (string) -> TipTap JSONContent (ProseMirror document)
export function markdownToTiptapDoc(markdown: string): JSONContent {
	const input = rawMarkdownAddEmptyMarkers(markdown);
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRemoveEmptyMarkers);
	const parsed = processor.parse(input);
	const tree = processor.runSync(parsed) as Root;
	return {
		type: "doc",
		content: normalizeBlockContent(tree.children).flatMap(blockToPM),
	} satisfies JSONContent;
}

function normalizeBlockContent(children: Content[]): Content[] {
	// mdast root.children are already block-level. Return as-is for now.
	return children;
}

function blockToPM(node: Content): JSONContent[] {
	switch (node.type) {
		case "paragraph": {
			if (node.children.some((child) => child.type === "image")) {
				return splitParagraphAroundImages(node.children);
			}
			const paragraphHtml = node.children.every(
				(child) => child.type === "html",
			)
				? node.children.map((child) => child.value).join("")
				: null;
			if (paragraphHtml) {
				const embed = htmlToEmbed(paragraphHtml);
				if (embed) return [embed];
			}

			return [
				{
					type: "paragraph",
					content: inlineToPM(node.children ?? []),
				},
			];
		}
		case "heading":
			return [
				{
					type: "heading",
					attrs: { level: node.depth ?? 1 },
					content: inlineToPM(node.children ?? []),
				},
			];
		case "blockquote":
			return [
				{
					type: "blockquote",
					content: (node.children ?? []).flatMap((n) =>
						blockToPM(n as Content),
					),
				},
			];
		case "code":
			return [
				{
					type: "codeBlock",
					attrs: { language: node.lang ?? null },
					content: node.value ? [{ type: "text", text: node.value }] : [],
				},
			];
		case "thematicBreak":
			return [{ type: "horizontalRule" }];
		case "list": {
			const list = node as List;
			if (list.ordered) {
				// Ordered list: ignore any task checkbox semantics
				return [
					{
						type: "orderedList",
						attrs: { start: list.start ?? 1 },
						content: list.children.flatMap((li) =>
							listItemToPM(li as ListItem, /* allowChecked */ false),
						),
					},
				];
			}

			// Bullet list: allow listItem.checked to flow into attrs.checked
			return [
				{
					type: "bulletList",
					content: list.children.flatMap((li) =>
						listItemToPM(li as ListItem, /* allowChecked */ true),
					),
				},
			];
		}
		case "html": {
			// Parse HTML to extract known block nodes, fallback to text for everything else
			const raw = node.value ?? "";
			if (raw.trim() === "") return [];

			try {
				const hastTree = fromHtml(raw, { fragment: true });
				const embed = hastToEmbed(hastTree);
				if (embed) {
					return [embed];
				}
				const images = extractImagesFromHast(hastTree);
				if (images.length > 0) {
					return images;
				}
			} catch {
				// If parsing fails, fall through to text fallback
			}

			// Fallback: keep raw HTML as a text paragraph to avoid data loss
			return [
				{
					type: "paragraph",
					content: [{ type: "text", text: raw }],
				},
			];
		}
		case "table": {
			const tableNode = node as import("mdast").Table;
			return [
				{
					type: "table",
					content: tableNode.children.map((row, rowIndex) => ({
						type: "tableRow",
						content: row.children.map((cell) => ({
							type: rowIndex === 0 ? "tableHeader" : "tableCell",
							content: [
								{
									type: "paragraph",
									content: inlineToPM(cell.children ?? []),
								},
							],
						})),
					})),
				},
			];
		}
		case "image": {
			return imageToPM(node as Image);
		}
		default: {
			// Unknown block: try to stringify inline if possible or drop.
			// For safety, don’t throw; produce nothing.
			return [];
		}
	}
}

function hastToEmbed(root: HastRoot): JSONContent | null {
	const children = root.children.filter(hasMeaningfulHtml);
	if (children.length !== 1) return null;
	const [node] = children;
	if (!isHastElement(node)) return null;

	const tagName = node.tagName.toLowerCase();
	if (node.children.some(hasMeaningfulHtml)) return null;

	if (tagName === "iframe") {
		const src = getStringProperty(node.properties?.src);
		if (!isValidIframeEmbedSrc(src)) return null;
		return {
			type: "embed",
			attrs: {
				kind: "iframe",
				src,
			},
		};
	}

	return null;
}

const BLOCKED_IFRAME_SCHEME = /^(file:|data:|javascript:|hubble-asset:)/i;
const LOCAL_IFRAME_SRC = /^(\.{1,2}\/|[^:/\\]+(?:\/|$)).*\.html(?:[?#].*)?$/i;

function getStringProperty(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return "";
}

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

function isHastElement(node: RootContent): node is HastElement {
	return node.type === "element";
}

function hasMeaningfulHtml(node: RootContent): boolean {
	return node.type !== "text" || node.value.trim() !== "";
}

function listItemToPM(li: ListItem, allowChecked: boolean): JSONContent[] {
	// mdast listItem children may be paragraphs and nested lists.
	const blocks = (li.children ?? []) as Content[];
	const first = blocks[0];
	const paragraphContent =
		first && first.type === "paragraph" ? inlineToPM(first.children ?? []) : [];
	const restBlocks = (
		first && first.type === "paragraph" ? blocks.slice(1) : blocks
	).flatMap(blockToPM);
	const content: JSONContent[] = [];
	content.push({ type: "paragraph", content: paragraphContent });
	content.push(...restBlocks);

	const checkedAttr = allowChecked && li.checked != null ? !!li.checked : null;
	return [
		{
			type: "listItem",
			attrs: { checked: checkedAttr },
			content,
		},
	];
}

// Images are block nodes in the editor schema, so a paragraph mixing images
// with other inline content becomes image blocks with paragraphs between them.
function splitParagraphAroundImages(children: Content[]): JSONContent[] {
	const blocks: JSONContent[] = [];
	let run: Content[] = [];
	const flushRun = () => {
		const content = inlineToPM(trimInlineRun(run));
		run = [];
		if (content.length > 0) blocks.push({ type: "paragraph", content });
	};
	for (const child of children) {
		if (child.type === "image") {
			flushRun();
			blocks.push(...imageToPM(child));
		} else {
			run.push(child);
		}
	}
	flushRun();
	return blocks;
}

function trimInlineRun(run: Content[]): Content[] {
	const trimmed = [...run];
	const first = trimmed[0];
	if (first?.type === "text") {
		const value = first.value.trimStart();
		if (value) trimmed[0] = { ...first, value };
		else trimmed.shift();
	}
	const last = trimmed[trimmed.length - 1];
	if (last?.type === "text") {
		const value = last.value.trimEnd();
		if (value) trimmed[trimmed.length - 1] = { ...last, value };
		else trimmed.pop();
	}
	return trimmed;
}

function imageToPM(imageNode: Image): JSONContent[] {
	if (!imageNode.url) return [];
	return [
		{
			type: "image",
			attrs: {
				src: imageNode.url || "",
				alt: imageNode.alt || "",
				title: imageNode.title || undefined,
			},
		},
	];
}

function htmlToEmbed(raw: string | undefined): JSONContent | null {
	if (!raw?.trim()) return null;
	try {
		return hastToEmbed(fromHtml(raw, { fragment: true }));
	} catch {
		return null;
	}
}

function inlineToPM(children: Content[]): JSONContent[] {
	const out: JSONContent[] = [];
	const items = [...(children ?? [])];
	for (let index = 0; index < items.length; index += 1) {
		const child = items[index];
		const reviewSpan = reviewSpanFromChildren(items, index);
		if (reviewSpan) {
			if (reviewSpan.prefix) out.push(...textToPM(reviewSpan.prefix));
			const content = inlineToPM(reviewSpan.content);
			out.push(...applyMark(content, "reviewMark", reviewSpan.attrs));
			if (reviewSpan.suffix) {
				items.splice(reviewSpan.endIndex + 1, 0, {
					type: "text",
					value: reviewSpan.suffix,
				});
			}
			index = reviewSpan.endIndex;
			continue;
		}

		const replacement = replacementFromGfmDelete(
			items[index + 1],
			child,
			items[index + 2],
		);
		if (replacement) {
			const next = items[index + 2];
			if (child.type === "text")
				out.push(...textToPM(child.value.slice(0, -1)));
			out.push(...replacement.nodes);
			if (next?.type === "text") {
				out.push(...textToPM(next.value.slice(replacement.closeLength)));
			}
			index += 2;
			continue;
		}

		switch (child.type) {
			case "text":
				if (child.value && child.value.length > 0) {
					out.push(...textToPM(child.value));
				}
				break;
			case "strong":
				out.push(...applyMark(inlineToPM(child.children ?? []), "bold"));
				break;
			case "emphasis":
				out.push(...applyMark(inlineToPM(child.children ?? []), "italic"));
				break;
			case "delete":
				out.push(...applyMark(inlineToPM(child.children ?? []), "strike"));
				break;
			case "inlineCode":
				if (child.value) {
					out.push({
						type: "text",
						text: child.value,
						marks: [{ type: "code" }],
					});
				}
				break;
			case "break":
				out.push({ type: "hardBreak" });
				break;
			case "link":
				out.push(
					...applyMark(
						inlineToPM(child.children ?? []),
						"link",
						typeof child.url === "string"
							? { href: child.url, kind: "url", target: null }
							: undefined,
					),
				);
				break;
			case "image":
				// Not supported; render alt text inline.
				if (child.alt) out.push({ type: "text", text: child.alt });
				break;
			case "html":
				if (mergeReviewMetadata(out, child.value)) {
					break;
				}
				if (isHtmlLineBreak(child.value)) {
					out.push({ type: "hardBreak" });
				} else if (child.value) {
					out.push({ type: "text", text: child.value });
				}
				break;
			default:
				// Unknown inline; ignore.
				break;
		}
	}
	return out;
}

const REVIEW_SPAN_PATTERN =
	/\{==((?:\\[\s\S]|(?!==\})[\s\S])+?)==\}(?:\{>>((?:\\[\s\S]|(?!<<\})[\s\S])*)<<\})?(?:\{#([A-Za-z0-9_-]+)\})?|\{\+\+([\s\S]+?)\+\+\}(?:\{#([A-Za-z0-9_-]+)\})?|\{--([\s\S]+?)--\}(?:\{#([A-Za-z0-9_-]+)\})?|\{~~((?:\\[\s\S]|(?!~>)[\s\S])+?)~>([\s\S]+?)~~\}(?:\{#([A-Za-z0-9_-]+)\})?/g;

function reviewSpanFromChildren(children: Content[], index: number) {
	const first = children[index];
	if (first?.type !== "text") return null;

	const selfContainedSpans = [...first.value.matchAll(REVIEW_SPAN_PATTERN)];
	const searchStart =
		selfContainedSpans.length > 0
			? (selfContainedSpans[selfContainedSpans.length - 1]?.index ?? 0) +
				(selfContainedSpans[selfContainedSpans.length - 1]?.[0]?.length ?? 0)
			: 0;

	let opening: string | null = null;
	let openingIndex = -1;
	for (const candidate of ["{==", "{++", "{--"]) {
		const idx = first.value.indexOf(candidate, searchStart);
		if (idx !== -1 && (openingIndex === -1 || idx < openingIndex)) {
			opening = candidate;
			openingIndex = idx;
		}
	}
	if (!opening) return null;

	const baseType =
		opening === "{=="
			? "reviewHighlight"
			: opening === "{++"
				? "reviewInsertion"
				: "reviewDeletion";
	const closing = opening === "{==" ? "==}" : opening === "{++" ? "++}" : "--}";

	for (let endIndex = index + 1; endIndex < children.length; endIndex += 1) {
		const candidate = children[endIndex];
		if (candidate?.type !== "text") continue;
		const closeIndex = findUnescaped(candidate.value, closing);
		if (closeIndex === -1) continue;

		let suffix = candidate.value.slice(closeIndex + closing.length);
		let type = baseType;
		let attrs: Record<string, unknown> = { type };
		if (baseType === "reviewHighlight") {
			const comment = suffix.match(
				/^\{>>((?:\\[\s\S]|(?!<<\})[\s\S])*)<<\}(?:\{#([A-Za-z0-9_-]+)\})?/,
			);
			if (comment) {
				type = "reviewComment";
				attrs = {
					type,
					body: unescapeReviewText(comment[1] ?? ""),
					id: comment[2] ?? null,
				};
				suffix = suffix.slice(comment[0].length);
			}
		} else {
			const id = suffix.match(/^\{#([A-Za-z0-9_-]+)\}/);
			if (id) {
				attrs = { type, id: id[1] };
				suffix = suffix.slice(id[0].length);
			}
		}

		const remainder = unescapeReviewText(
			first.value.slice(openingIndex + opening.length),
		);
		const content: Content[] = [
			...(remainder ? [{ type: "text" as const, value: remainder }] : []),
			...children.slice(index + 1, endIndex).map(unescapeReviewMdastText),
		];
		const innerText = unescapeReviewText(candidate.value.slice(0, closeIndex));
		if (innerText) content.push({ type: "text", value: innerText });
		return {
			prefix: first.value.slice(0, openingIndex),
			content,
			suffix,
			endIndex,
			attrs,
		};
	}

	return null;
}

function mergeReviewMetadata(nodes: JSONContent[], value: string | undefined) {
	const metadata = parseReviewMetadata(value);
	if (!metadata) return false;

	let merged = false;
	let targetId: unknown;
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node = nodes[index];
		const reviewMarkIndex =
			node.type === "text"
				? node.marks?.findIndex(
						(mark) =>
							mark.type === "reviewMark" &&
							mark.attrs?.type === "reviewComment",
					)
				: -1;
		if (reviewMarkIndex === undefined || reviewMarkIndex === -1) {
			if (merged) break;
			continue;
		}

		const marks = [...(node.marks ?? [])];
		const mark = marks[reviewMarkIndex];
		if (!merged) {
			targetId = mark.attrs?.id;
		} else if (targetId == null || mark.attrs?.id !== targetId) {
			break;
		}
		marks[reviewMarkIndex] = {
			...mark,
			attrs: { ...mark.attrs, ...metadata },
		};
		nodes[index] = { ...node, marks };
		merged = true;
		if (targetId == null) break;
	}

	return merged;
}

function replacementFromGfmDelete(
	child: Content | undefined,
	previous: Content | undefined,
	next: Content | undefined,
) {
	// remark-gfm parses the `~~...~~` inside a CriticMarkup replacement as a
	// delete node, so recover the surrounding braces before normal inline parsing.
	if (
		child?.type !== "delete" ||
		previous?.type !== "text" ||
		next?.type !== "text" ||
		!previous.value.endsWith("{")
	) {
		return null;
	}

	const split = splitReplacementChildren(child.children ?? []);
	const closing = next.value.match(/^\}(?:\{#([A-Za-z0-9_-]+)\})?/);
	if (!split || !closing) return null;

	const attrs = {
		type: "reviewReplacement",
		original: split.originalText,
		id: closing[1] ?? null,
	};
	const newContent = inlineToPM(split.newChildren);
	const nodes = applyMark(
		newContent.length > 0 ? newContent : [{ type: "text", text: "" }],
		"reviewMark",
		attrs,
	);

	return {
		nodes,
		closeLength: closing[0].length,
	};
}

/**
 * Splits a GFM delete node at `~>`. The pre-arrow side keeps its inline
 * Markdown as a string attribute; the new side is left for `inlineToPM`.
 */
function splitReplacementChildren(children: Content[]) {
	const originalParts: string[] = [];
	for (let index = 0; index < children.length; index += 1) {
		const node = children[index];
		if (node.type !== "text") {
			const markdown = inlineMdastNodeToMarkdown(node);
			if (markdown === null) return null;
			originalParts.push(unescapeReviewText(markdown));
			continue;
		}
		const arrowIndex = findUnescaped(node.value, "~>");
		if (arrowIndex === -1) {
			originalParts.push(node.value);
			continue;
		}
		originalParts.push(unescapeReviewText(node.value.slice(0, arrowIndex)));
		const after = node.value.slice(arrowIndex + 2);
		const newChildren: Content[] = [
			...(after ? [{ type: "text" as const, value: after }] : []),
			...children.slice(index + 1),
		];
		return { originalText: originalParts.join(""), newChildren };
	}
	return null;
}

function inlineMdastNodeToMarkdown(node: Content): string | null {
	const serializeChildren = (children: Content[]) => {
		const parts = children.map(inlineMdastNodeToMarkdown);
		return parts.some((part) => part === null) ? null : parts.join("");
	};

	switch (node.type) {
		case "text":
			return node.value;
		case "strong": {
			const content = serializeChildren(node.children);
			return content === null ? null : `**${content}**`;
		}
		case "emphasis": {
			const content = serializeChildren(node.children);
			return content === null ? null : `*${content}*`;
		}
		case "delete": {
			const content = serializeChildren(node.children);
			return content === null ? null : `~~${content}~~`;
		}
		case "inlineCode":
			return `\`${node.value.split("`").join("\\`")}\``;
		case "link": {
			const content = serializeChildren(node.children);
			if (content === null) return null;
			const title = node.title ? ` "${node.title.split('"').join('\\"')}"` : "";
			return `[${content}](${node.url}${title})`;
		}
		case "image": {
			const title = node.title ? ` "${node.title.split('"').join('\\"')}"` : "";
			return `![${node.alt ?? ""}](${node.url}${title})`;
		}
		case "break":
			return "\\\n";
		case "html":
			return node.value;
		default:
			return null;
	}
}

function isHtmlLineBreak(value: string | undefined): boolean {
	return typeof value === "string" && /^<br\s*\/?>$/i.test(value.trim());
}

function textToPM(text: string): JSONContent[] {
	const out: JSONContent[] = [];
	const wikiLinkPattern = /\[\[([^\]\n]+)\]\]/g;
	const matches = [...text.matchAll(REVIEW_SPAN_PATTERN)];
	if (matches.length > 0) {
		let lastIndex = 0;
		for (const match of matches) {
			const index = match.index ?? 0;
			if (index > lastIndex) {
				out.push(...textToPM(text.slice(lastIndex, index)));
			}

			const commentText = match[2];
			const commentId = match[3] ?? match[5] ?? match[7] ?? match[10] ?? null;
			const mark =
				commentText !== undefined
					? {
							type: "reviewMark",
							attrs: {
								type: "reviewComment",
								body: unescapeReviewText(commentText),
								id: commentId,
							},
						}
					: match[1] !== undefined
						? {
								type: "reviewMark",
								attrs: {
									type: "reviewHighlight",
									id: commentId,
								},
							}
						: match[4] !== undefined
							? {
									type: "reviewMark",
									attrs: { type: "reviewInsertion", id: commentId },
								}
							: match[6] !== undefined
								? {
										type: "reviewMark",
										attrs: { type: "reviewDeletion", id: commentId },
									}
								: {
										type: "reviewMark",
										attrs: {
											type: "reviewReplacement",
											original: match[8] ?? "",
											id: commentId,
										},
									};
			if (mark.attrs?.type === "reviewReplacement") {
				mark.attrs.original = unescapeReviewText(String(mark.attrs.original));
			}
			const value = unescapeReviewText(
				match[1] ?? match[4] ?? match[6] ?? match[9] ?? match[0],
			);
			out.push({ type: "text", text: value, marks: [mark] });
			lastIndex = index + match[0].length;
		}
		if (lastIndex < text.length) {
			out.push(...textToPM(text.slice(lastIndex)));
		}
		return out;
	}

	let lastIndex = 0;
	for (const match of text.matchAll(wikiLinkPattern)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			out.push({ type: "text", text: text.slice(lastIndex, index) });
		}

		const rawLink = match[1] ?? "";
		const separatorIndex = rawLink.indexOf("|");
		const rawTarget =
			separatorIndex === -1 ? rawLink : rawLink.slice(0, separatorIndex);
		const rawAlias =
			separatorIndex === -1 ? "" : rawLink.slice(separatorIndex + 1);
		const target = rawTarget.trim();
		if (target) {
			out.push({
				type: "text",
				text: rawAlias || wikiDisplayNameForTarget(target),
				marks: [
					{
						type: "link",
						attrs: { href: target, kind: "wiki", target },
					},
				],
			});
		} else {
			out.push({ type: "text", text: match[0] });
		}
		lastIndex = index + match[0].length;
	}

	if (lastIndex < text.length) {
		out.push({ type: "text", text: text.slice(lastIndex) });
	}
	return out;
}

function findUnescaped(value: string, delimiter: string): number {
	let index = value.indexOf(delimiter);
	while (index !== -1) {
		let backslashes = 0;
		for (
			let cursor = index - 1;
			cursor >= 0 && value[cursor] === "\\";
			cursor--
		) {
			backslashes += 1;
		}
		if (backslashes % 2 === 0) return index;
		index = value.indexOf(delimiter, index + delimiter.length);
	}
	return -1;
}

function unescapeReviewMdastText(node: Content): Content {
	if (node.type === "text") {
		return { ...node, value: unescapeReviewText(node.value) };
	}
	if ("children" in node && Array.isArray(node.children)) {
		return {
			...node,
			children: node.children.map((child) =>
				unescapeReviewMdastText(child as Content),
			),
		} as Content;
	}
	return node;
}

function applyMark(
	nodes: JSONContent[],
	markType: "bold" | "italic" | "strike" | "link" | "reviewMark",
	attrs?: Record<string, unknown>,
): JSONContent[] {
	return nodes.map((n) => {
		if (n.type === "text") {
			const marks = [
				...(n.marks ?? []),
				attrs ? { type: markType, attrs } : { type: markType },
			];
			return { ...n, marks };
		}
		// For nested structures, descend if needed; most inline nodes here are text/hardBreak only.
		return n;
	});
}

const EMPTY_PARKER = "HUBBLE_INTERNAL_EMPTY_MARKER";

function rawMarkdownAddEmptyMarkers(rawMarkdown: string) {
	return (
		rawMarkdown
			// Handle empty paragraphs by double newlines
			.split("\n\n")
			.map((line) => {
				// Runs of empty lines are truncated into a single paragraph.
				// Add a marker to force each empty line to be a new paragraph.
				if (line.length === 0) {
					return EMPTY_PARKER;
				}
				return line;
			})
			.join("\n\n")
			// Handle empty checklist items by single newline
			.split("\n")
			.map((line) => {
				if (line.match(/^-\s\[(\s|x)\]\s*$/)) {
					return `${line} ${EMPTY_PARKER}`;
				}
				return line;
			})
			.join("\n")
	);
}

/**
 * Extract image nodes from a HAST tree (parsed HTML).
 */
function extractImagesFromHast(hastTree: HastRoot): JSONContent[] {
	const images: JSONContent[] = [];

	function visitHastNode(node: HastRoot | HastElement) {
		if (node.type === "element" && node.tagName === "img") {
			const attrs: {
				src?: string;
				alt?: string;
				title?: string;
				width?: number;
				height?: number;
			} = {};
			if (node.properties?.src) attrs.src = String(node.properties.src);
			if (node.properties?.alt) attrs.alt = String(node.properties.alt);
			if (node.properties?.title) attrs.title = String(node.properties.title);
			if (node.properties?.width)
				attrs.width = Number(node.properties.width) || undefined;
			if (node.properties?.height)
				attrs.height = Number(node.properties.height) || undefined;

			images.push({ type: "image", attrs });
		}

		if ("children" in node && node.children) {
			for (const child of node.children) {
				if (child.type === "element") {
					visitHastNode(child);
				}
			}
		}
	}

	visitHastNode(hastTree);
	return images;
}

const remarkRemoveEmptyMarkers: Plugin<[]> = () => {
	return (tree) => {
		visit(tree, "paragraph", (node: Paragraph) => {
			const paragraphText = node.children
				.filter((child) => child.type === "text")
				.map((child) => child.value)
				.join("");

			if (paragraphText.includes(EMPTY_PARKER)) {
				node.children = [];
			}
		});
	};
};
