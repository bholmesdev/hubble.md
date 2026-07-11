import { Mark } from "@tiptap/core";

export type ReviewMarkName =
	| "reviewComment"
	| "reviewHighlight"
	| "reviewInsertion"
	| "reviewDeletion"
	| "reviewReplacement";

export type ReviewMarkAttrs = {
	body?: string;
	id?: string | null;
	original?: string;
};

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
