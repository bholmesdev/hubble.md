import { Mark } from "@tiptap/core";

export type ReviewMarkName =
	| "reviewComment"
	| "reviewHighlight"
	| "reviewInsertion"
	| "reviewDeletion"
	| "reviewReplacement";

export type ReviewReply = {
	body: string;
	id: string;
	author?: "human" | "agent";
	createdAt?: string;
};

export type ReviewMarkAttrs = {
	body?: string;
	id?: string | null;
	original?: string;
	replies?: ReviewReply[];
	resolved?: boolean;
	metadata?: Record<string, unknown>;
	type?: ReviewMarkName;
};

const REVIEW_METADATA_PATTERN = /^<!--\s*hubble-review:([\s\S]*?)-->\s*$/;

export function serializeReviewMetadata(attrs: ReviewMarkAttrs): string {
	if (attrs.type !== "reviewComment") return "";
	if (!attrs.resolved && (!attrs.replies || attrs.replies.length === 0)) {
		return "";
	}

	const metadata = encodeURIComponent(
		JSON.stringify({
			...(attrs.metadata ?? {}),
			replies: attrs.replies ?? [],
			resolved: attrs.resolved === true,
		}),
	);
	return `<!-- hubble-review:${metadata}-->`;
}

export function parseReviewMetadata(
	value: string | undefined,
): Pick<ReviewMarkAttrs, "metadata" | "replies" | "resolved"> | null {
	if (!value) return null;
	const match = value.match(REVIEW_METADATA_PATTERN);
	if (!match) return null;

	try {
		const parsed = JSON.parse(decodeURIComponent(match[1] ?? "")) as Record<
			string,
			unknown
		> & {
			replies?: unknown;
			resolved?: unknown;
		};
		const replies = Array.isArray(parsed.replies)
			? parsed.replies.filter(isReviewReply)
			: [];
		return {
			replies,
			resolved: parsed.resolved === true,
			metadata: parsed,
		};
	} catch {
		return null;
	}
}

function isReviewReply(value: unknown): value is ReviewReply {
	if (!value || typeof value !== "object") return false;
	const reply = value as Partial<ReviewReply>;
	return typeof reply.id === "string" && typeof reply.body === "string";
}

/**
 * The Markdown parser stores review spans as marks so review state can move
 * with the selected text when the document is edited. The DOM attributes are
 * intentionally small; the Markdown serializer remains the source of truth.
 */
export const ReviewMarkExtension = Mark.create({
	name: "reviewMark",
	spanning: true,
	addAttributes() {
		return {
			type: {
				default: "reviewHighlight",
				parseHTML: (element) =>
					element.getAttribute("data-review-type") ?? "reviewHighlight",
				renderHTML: (attributes) => ({
					"data-review-type": attributes.type,
				}),
			},
			body: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-review-body"),
				renderHTML: (attributes) =>
					attributes.body ? { "data-review-body": attributes.body } : {},
			},
			id: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-review-id"),
				renderHTML: (attributes) =>
					attributes.id ? { "data-review-id": attributes.id } : {},
			},
			replies: { default: null, renderHTML: () => ({}) },
			resolved: {
				default: false,
				parseHTML: (element) => element.hasAttribute("data-review-resolved"),
				renderHTML: (attributes) =>
					attributes.resolved ? { "data-review-resolved": "" } : {},
			},
			metadata: { default: null, renderHTML: () => ({}) },
			original: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-review-original"),
				renderHTML: (attributes) =>
					attributes.original
						? { "data-review-original": attributes.original }
						: {},
			},
		};
	},
	parseHTML() {
		return [
			{ tag: "mark[data-review-type]" },
			{ tag: "ins[data-review-type]" },
			{ tag: "del[data-review-type]" },
			{ tag: "span[data-review-type='reviewReplacement']" },
		];
	},
	renderHTML({ HTMLAttributes }) {
		const type = HTMLAttributes["data-review-type"] as string;
		const tag =
			type === "reviewInsertion"
				? "ins"
				: type === "reviewDeletion"
					? "del"
					: type === "reviewReplacement"
						? "span"
						: "mark";
		return [tag, HTMLAttributes, 0];
	},
});
