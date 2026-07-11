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
				renderHTML: () => ({}),
			},
			body: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-review-body"),
				renderHTML: () => ({}),
			},
			id: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-review-id"),
				renderHTML: () => ({}),
			},
			original: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-review-original"),
				renderHTML: () => ({}),
			},
		};
	},
	parseHTML() {
		return [
			{ tag: "mark[data-review-type]" },
			{ tag: "ins[data-review-type]" },
			{ tag: "del[data-review-type]" },
			{ tag: "span[data-review-type='replacement']" },
		];
	},
	renderHTML({ HTMLAttributes }) {
		const {
			type: rawType,
			body,
			id,
			original,
			...domAttributes
		} = HTMLAttributes;
		const type = rawType as string;
		const tag =
			type === "reviewInsertion"
				? "ins"
				: type === "reviewDeletion"
					? "del"
					: type === "reviewReplacement"
						? "span"
						: "mark";
		return [
			tag,
			{
				...domAttributes,
				"data-review-type": type,
				...(body ? { "data-review-body": body } : {}),
				...(id ? { "data-review-id": id } : {}),
				...(original ? { "data-review-original": original } : {}),
			},
			0,
		];
	},
});
