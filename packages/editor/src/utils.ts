import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Selection as PMSelection } from "@tiptap/pm/state";

export function previousCodePointIndex(text: string, index: number) {
	if (index <= 0) return 0;
	const previous = text.charCodeAt(index - 1);
	return previous >= 0xdc00 && previous <= 0xdfff ? index - 2 : index - 1;
}

export function nextCodePointIndex(text: string, index: number) {
	const codePoint = text.codePointAt(index);
	return index + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

/**
 * Get the position of where the first text node starts in the given node.
 */
export function textStartPos(node: PMNode, pos: number): number | null {
	let textNodePos: number | null = null;
	node.descendants((child, offset) => {
		if (!textNodePos && child.isText) {
			textNodePos = pos + offset + 1;
			return false;
		}
		return true;
	});
	return textNodePos;
}

/**
 * Get the position of where the last text node ends in the given node.
 */
export function textEndPos(node: PMNode, pos: number): number | null {
	let textNodePos: number | null = null;
	node.descendants((child, offset) => {
		if (child.isText) {
			textNodePos = pos + offset + 1 + (child.text?.length ?? 0);
			return false;
		}
		return true;
	});
	return textNodePos;
}

/**
 * Get all parents of the given type
 * @param pos The position to get the parents of
 * @param type The node type to search for
 * @returns The parents of the given type, ordered from the nearest to the farthest
 */
export function parentsOfType(
	pos: ResolvedPos,
	type: string | string[],
): number[] {
	const parents: number[] = [];
	for (let d = pos.depth; d >= 0; d--) {
		const node = pos.node(d);
		if (
			Array.isArray(type)
				? type.includes(node.type.name)
				: node.type.name === type
		) {
			parents.push(pos.before(d));
		}
	}
	return parents;
}

export function nearestSharedParentOfType(
	from: ResolvedPos,
	to: ResolvedPos,
	type: string | string[],
): number | null {
	const fromParents = parentsOfType(from, type);
	const toParents = parentsOfType(to, type);
	for (const fromParent of fromParents) {
		if (toParents.includes(fromParent)) {
			return fromParent;
		}
	}
	return null;
}

export function isSelectionAtStartOfNode(selection: PMSelection) {
	return selection.empty && selection.$from.parentOffset === 0;
}
