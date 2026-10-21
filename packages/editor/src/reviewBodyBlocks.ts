import type { Content, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import { escapeReviewBody } from "./reviewEscaping.js";

/**
 * Comment bodies that span block boundaries.
 *
 * `{==anchor==}{>>body<<}{#c1}` only parses when the body sits inside one
 * block. A body with a blank line in it splits into several blocks, so the
 * opener and the closer end up apart and the raw syntax shows in the note.
 *
 * The body is folded back onto one line, with its line breaks escaped the
 * same way Hubble escapes a body it wrote itself. Escaping rather than
 * deleting the breaks keeps the body readable, and keeps it inside the
 * block it started in, so a body that starts in a heading does not end it.
 */

const BODY_OPEN = "{>>";
const BODY_CLOSE = "<<}";

/** A block whose children hold inline content. */
type InlineContainer = {
	children: Content[];
};

type CrossBlockBody = {
	/** The text node holding the body opener. */
	openNode: Text;
	/** Offset of the opener inside that node's value. */
	openIndex: number;
	/** The text node holding the body closer. */
	closeNode: Text;
	/** Offset of the closer inside that node's value. */
	closeIndex: number;
};

/** Blocks that hold inline content, in document order. */
function inlineContainers(tree: Root): InlineContainer[] {
	const containers: InlineContainer[] = [];
	visit(tree, (node) => {
		if (node.type !== "paragraph" && node.type !== "heading") return;
		const children = "children" in node ? node.children : undefined;
		containers.push({ children: (children ?? []) as Content[] });
	});
	return containers;
}

/** The first `{>>` in a container, and whether its `<<}` follows in the same one. */
function openerIn(container: InlineContainer): {
	node: Text;
	index: number;
	closedHere: boolean;
} | null {
	for (const child of container.children) {
		if (child.type !== "text") continue;
		const openIndex = child.value.indexOf(BODY_OPEN);
		if (openIndex === -1) continue;
		const closeIndex = child.value.indexOf(
			BODY_CLOSE,
			openIndex + BODY_OPEN.length,
		);
		return { node: child, index: openIndex, closedHere: closeIndex !== -1 };
	}
	return null;
}

/** The first `<<}` in a container. */
function closerIn(container: InlineContainer): {
	node: Text;
	index: number;
} | null {
	for (const child of container.children) {
		if (child.type !== "text") continue;
		const closeIndex = child.value.indexOf(BODY_CLOSE);
		if (closeIndex !== -1) return { node: child, index: closeIndex };
	}
	return null;
}

/**
 * Finds a comment body whose closer sits in a later block than its opener.
 * A body that closes inside its own block is already read by the inline
 * parser, so it is left alone.
 */
function findCrossBlockBody(tree: Root): CrossBlockBody | null {
	const containers = inlineContainers(tree);

	for (let index = 0; index < containers.length; index += 1) {
		const openContainer = containers[index] as InlineContainer;
		const opener = openerIn(openContainer);
		if (!opener || opener.closedHere) continue;

		for (let next = index + 1; next < containers.length; next += 1) {
			const container = containers[next] as InlineContainer;
			const closer = closerIn(container);
			if (!closer) continue;

			return {
				openNode: opener.node,
				openIndex: opener.index,
				closeNode: closer.node,
				closeIndex: closer.index,
			};
		}
	}

	return null;
}

/**
 * Finds where a delimiter sits in the source, given the text node that holds
 * it and its offset in that node's value. Remark strips escapes, so the
 * source slice and the value can differ.
 */
function delimiterOffset(
	source: string,
	node: Text,
	valueIndex: number,
	delimiter: string,
): number | null {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start === undefined || end === undefined) return null;

	const slice = source.slice(start, end);
	if (slice === node.value) {
		const offset = start + valueIndex;
		return source.startsWith(delimiter, offset) ? offset : null;
	}

	// Walk the source and the value together: an escape contributes one
	// character to the value and two to the source.
	let sourceIndex = 0;
	let valueOffset = 0;
	while (valueOffset < valueIndex && sourceIndex < slice.length) {
		if (slice[sourceIndex] === "\\" && sourceIndex + 1 < slice.length) {
			sourceIndex += 2;
			valueOffset += 1;
			continue;
		}
		sourceIndex += 1;
		valueOffset += 1;
	}

	const offset = start + sourceIndex;
	return source.startsWith(delimiter, offset) ? offset : null;
}

/**
 * Rewrites a cross-block body onto one line. The body keeps its text; its
 * line breaks and any Markdown punctuation are escaped, which is the same
 * shape Hubble writes for a body it created itself.
 */
function foldBody(source: string, body: CrossBlockBody): string | null {
	const openOffset = delimiterOffset(
		source,
		body.openNode,
		body.openIndex,
		BODY_OPEN,
	);
	const closeOffset = delimiterOffset(
		source,
		body.closeNode,
		body.closeIndex,
		BODY_CLOSE,
	);
	if (openOffset === null || closeOffset === null) return null;
	if (closeOffset <= openOffset) return null;

	// The body is taken from the source, so the text it held across the
	// blocks it spanned survives, including its line breaks. Everything
	// after the closer is left exactly as it was.
	const rawBody = source.slice(openOffset + BODY_OPEN.length, closeOffset);
	const folded =
		source.slice(0, openOffset + BODY_OPEN.length) +
		escapeReviewBody(rawBody) +
		source.slice(closeOffset);

	// A fold that changes nothing means the body was not what it looked
	// like, and rewriting it again would loop.
	return folded === source ? null : folded;
}

/**
 * Folds every comment body that spans block boundaries. Each fold changes
 * the source, so the document is parsed again until no cross-block body is
 * left.
 */
export function foldCrossBlockBodies(
	parse: (source: string) => Root,
	source: string,
	maxPasses = 8,
): string {
	let current = source;

	for (let pass = 0; pass < maxPasses; pass += 1) {
		const body = findCrossBlockBody(parse(current));
		if (!body) break;
		const folded = foldBody(current, body);
		if (!folded) break;
		current = folded;
	}

	return current;
}
