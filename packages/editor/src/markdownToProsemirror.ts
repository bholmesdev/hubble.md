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
			const [maybeImage] = node.children;
			if (maybeImage?.type === "image") {
				return imageToPM(maybeImage);
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
	for (let index = 0; index < (children ?? []).length; index += 1) {
		const child = children[index];
		const reviewSpan = reviewSpanFromChildren(children, index);
		if (reviewSpan) {
			if (reviewSpan.prefix) out.push(...textToPM(reviewSpan.prefix));
			const content = inlineToPM(reviewSpan.content);
			out.push(...applyMark(content, "reviewMark", reviewSpan.attrs));
			if (reviewSpan.suffix) out.push(...textToPM(reviewSpan.suffix));
			index = reviewSpan.endIndex;
			continue;
		}

		const replacement = replacementFromGfmDelete(
			children[index + 1],
			child,
			children[index + 2],
		);
		if (replacement) {
			const next = children[index + 2];
			if (child.type === "text")
				out.push(...textToPM(child.value.slice(0, -1)));
			out.push(replacement.node);
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

function reviewSpanFromChildren(children: Content[], index: number) {
	// remark parses emphasis inside a review wrapper as sibling mdast nodes;
	// reconstruct the wrapper before recursively converting its formatted content.
	const first = children[index];
	if (first?.type !== "text") return null;

	const opening = ["{==", "{++", "{--"].find((value) =>
		first.value.endsWith(value),
	);
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
		const closeIndex = candidate.value.indexOf(closing);
		if (closeIndex === -1) continue;

		let suffix = candidate.value.slice(closeIndex + closing.length);
		let type = baseType;
		let attrs: Record<string, unknown> = { type };
		if (baseType === "reviewHighlight") {
			const comment = suffix.match(
				/^\{>>([\s\S]*?)<<\}(?:\{#([A-Za-z0-9_-]+)\})?/,
			);
			if (comment) {
				type = "reviewComment";
				attrs = {
					type,
					body: comment[1] ?? "",
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

		const content = children.slice(index + 1, endIndex);
		const innerText = candidate.value.slice(0, closeIndex);
		if (innerText) content.push({ type: "text", value: innerText });
		return {
			prefix: first.value.slice(0, -opening.length),
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

	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node = nodes[index];
		if (node.type !== "text") continue;
		const reviewMarkIndex = node.marks?.findIndex(
			(mark) =>
				mark.type === "reviewMark" && mark.attrs?.type === "reviewComment",
		);
		if (reviewMarkIndex === undefined || reviewMarkIndex === -1) continue;

		const marks = [...(node.marks ?? [])];
		const mark = marks[reviewMarkIndex];
		marks[reviewMarkIndex] = {
			...mark,
			attrs: { ...mark.attrs, ...metadata },
		};
		nodes[index] = { ...node, marks };
		return true;
	}

	return false;
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

	const deletedText = child.children
		.filter((nested) => nested.type === "text")
		.map((nested) => nested.value)
		.join("");
	const replacement = deletedText.match(/^([\s\S]+?)~>([\s\S]+)$/);
	const closing = next.value.match(/^\}(?:\{#([A-Za-z0-9_-]+)\})?/);
	if (!replacement || !closing) return null;

	return {
		node: {
			type: "text",
			text: replacement[2],
			marks: [
				{
					type: "reviewMark",
					attrs: {
						type: "reviewReplacement",
						original: replacement[1],
						id: closing[1] ?? null,
					},
				},
			],
		},
		closeLength: closing[0].length,
	};
}

function isHtmlLineBreak(value: string | undefined): boolean {
	return typeof value === "string" && /^<br\s*\/?>$/i.test(value.trim());
}

function textToPM(text: string): JSONContent[] {
	const out: JSONContent[] = [];
	const reviewPattern =
		/\{==([\s\S]+?)==\}(?:\{>>([\s\S]*?)<<\})?(?:\{#([A-Za-z0-9_-]+)\})?|\{\+\+([\s\S]+?)\+\+\}(?:\{#([A-Za-z0-9_-]+)\})?|\{--([\s\S]+?)--\}(?:\{#([A-Za-z0-9_-]+)\})?|\{~~([\s\S]+?)~>([\s\S]+?)~~\}(?:\{#([A-Za-z0-9_-]+)\})?/g;
	const wikiLinkPattern = /\[\[([^\]\n]+)\]\]/g;
	const matches = [...text.matchAll(reviewPattern)];
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
								body: commentText,
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
			const value = match[1] ?? match[4] ?? match[6] ?? match[9] ?? match[0];
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
