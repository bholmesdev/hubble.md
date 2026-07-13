import { Mark, mergeAttributes } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

export const LinkExtension = Mark.create({
	name: "link",
	inclusive: true,
	keepOnSplit: false,

	addAttributes() {
		return {
			href: {
				default: "",
			},
			kind: {
				default: "url",
			},
			target: {
				default: null,
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: "span[data-href]",
				getAttrs: (element) => {
					const href = (element as HTMLElement).getAttribute("data-href");
					const kind = (element as HTMLElement).getAttribute("data-link-kind");
					const target = (element as HTMLElement).getAttribute("data-target");
					return {
						href: href ?? "",
						kind: kind === "wiki" ? "wiki" : "url",
						target,
					};
				},
			},
			{
				tag: "a[href]",
				getAttrs: (element) => {
					const anchor = element as HTMLAnchorElement;
					const href = anchor.getAttribute("href");
					const kind = anchor.getAttribute("data-link-kind");
					const target = anchor.getAttribute("data-target");
					return {
						href: href ?? "",
						kind: kind === "wiki" ? "wiki" : "url",
						target,
					};
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		const href =
			typeof HTMLAttributes.href === "string" ? HTMLAttributes.href : "";
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-href": href,
				"data-link-kind": HTMLAttributes.kind === "wiki" ? "wiki" : "url",
				"data-target":
					typeof HTMLAttributes.target === "string"
						? HTMLAttributes.target
						: undefined,
				"data-link": "true",
			}),
			0,
		];
	},
});

export type LinkKind = "url" | "wiki";
export type LinkAttrs = {
	href: string;
	kind: LinkKind;
	target: string | null;
};

function sameLinkAttrs(left: LinkAttrs, right: LinkAttrs): boolean {
	return (
		left.href === right.href &&
		left.kind === right.kind &&
		left.target === right.target
	);
}

export function createLinkMark(
	href = "",
	attrs?: Partial<Pick<LinkAttrs, "kind" | "target">>,
) {
	return {
		type: "link",
		attrs: { href, kind: attrs?.kind ?? "url", target: attrs?.target ?? null },
	};
}

export function getLinkAttrs(attrs: unknown): LinkAttrs | null {
	if (!attrs || typeof attrs !== "object") return null;
	const href = (attrs as Record<string, unknown>).href;
	if (typeof href !== "string") return null;
	const rawKind = (attrs as Record<string, unknown>).kind;
	const rawTarget = (attrs as Record<string, unknown>).target;
	return {
		href,
		kind: rawKind === "wiki" ? "wiki" : "url",
		target: typeof rawTarget === "string" ? rawTarget : null,
	};
}

export function getLinkHrefFromAttrs(attrs: unknown): string | null {
	return getLinkAttrs(attrs)?.href ?? null;
}

export function getActiveLinkRange(state: EditorState): {
	from: number;
	to: number;
	href: string;
	kind: LinkKind;
	target: string | null;
} | null {
	const { selection } = state;
	if (!selection.empty) return null;

	const markType = state.schema.marks.link;
	if (!markType) return null;

	const $pos = state.doc.resolve(selection.from);
	const parent = $pos.parent;

	let index: number | null = null;
	if ($pos.nodeAfter && markType.isInSet($pos.nodeAfter.marks)) {
		index = $pos.index();
	} else if ($pos.nodeBefore && markType.isInSet($pos.nodeBefore.marks)) {
		index = $pos.index() - 1;
	}
	if (index === null || index < 0 || index >= parent.childCount) {
		// No link text node at the cursor; fall back to a zero-width stored link.
		const mark = markType.isInSet(state.storedMarks ?? selection.$from.marks());
		if (!mark) return null;
		const attrs = getLinkAttrs(mark.attrs);
		if (attrs === null) return null;
		return { from: selection.from, to: selection.from, ...attrs };
	}

	const mark = markType.isInSet(parent.child(index).marks);
	const attrs = mark ? getLinkAttrs(mark.attrs) : null;
	if (attrs === null) return null;

	let startIndex = index;
	let endIndex = index;

	let from = $pos.start();
	for (let i = 0; i < startIndex; i++) {
		from += parent.child(i).nodeSize;
	}
	let to = from + parent.child(index).nodeSize;

	while (startIndex > 0) {
		const previousMark = markType.isInSet(parent.child(startIndex - 1).marks);
		const previousAttrs = previousMark
			? getLinkAttrs(previousMark.attrs)
			: null;
		if (!previousAttrs || !sameLinkAttrs(previousAttrs, attrs)) break;
		startIndex -= 1;
		from -= parent.child(startIndex).nodeSize;
	}

	while (endIndex + 1 < parent.childCount) {
		const nextMark = markType.isInSet(parent.child(endIndex + 1).marks);
		const nextAttrs = nextMark ? getLinkAttrs(nextMark.attrs) : null;
		if (!nextAttrs || !sameLinkAttrs(nextAttrs, attrs)) break;
		endIndex += 1;
		to += parent.child(endIndex).nodeSize;
	}

	return { from, to, ...attrs };
}
