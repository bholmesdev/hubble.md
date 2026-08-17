import { markdownToTiptapDoc } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";

export type SlashCommandKind =
	| "paragraph"
	| "heading1"
	| "heading2"
	| "heading3"
	| "bulletList"
	| "orderedList"
	| "taskList"
	| "blockquote"
	| "divider"
	| "strike"
	| "table";

export type SlashToken = {
	from: number;
	to: number;
	query: string;
};

export function findSlashToken(editor: Editor): SlashToken | null {
	if (!editor.isFocused || !editor.state.selection.empty) return null;
	const { $from } = editor.state.selection;
	const parent = $from.parent;
	if (!parent.isTextblock) return null;
	const textBefore = parent.textBetween(0, $from.parentOffset, "\n", "\0");
	// Slash commands start a phrase: beginning of the textblock or after
	// whitespace. This avoids triggering inside URLs and file paths.
	const match = /(^|\s)\/([^\s/]*)$/.exec(textBefore);
	if (!match) return null;
	const prefixLength = match[1].length;
	const query = match[2];
	const from = $from.start() + (match.index ?? 0) + prefixLength;
	return {
		from,
		to: $from.pos,
		query,
	};
}

export function applySlashCommand(
	editor: Editor,
	token: SlashToken,
	kind: SlashCommandKind,
) {
	const { state, view } = editor;
	const { schema } = state;
	const $from = state.doc.resolve(token.from);
	if ($from.depth === 0) return;
	const topLevelDepth = Math.min(1, $from.depth);
	const blockStart = $from.before(topLevelDepth);
	const blockEnd = $from.after(topLevelDepth);
	const block = state.doc.nodeAt(blockStart);
	if (kind === "strike") {
		const strike = schema.marks.strike;
		if (!strike) return;
		const tr = state.tr.delete(token.from, token.to);
		const mappedSelection = tr.selection;
		const marks = mappedSelection.$from.marks();
		tr.setStoredMarks(
			strike.isInSet(marks)
				? marks.filter((mark) => mark.type !== strike)
				: [...marks, strike.create()],
		);
		view.dispatch(tr.scrollIntoView());
		view.focus();
		return;
	}

	if (kind === "table") {
		const range = { from: token.from, to: token.to };
		editor
			.chain()
			.focus()
			.deleteRange(range)
			.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
			.run();
		return;
	}

	const canConvertInPlace =
		block?.type.name === "paragraph" &&
		block.content.size === token.to - token.from;
	const tr = state.tr.delete(token.from, token.to);

	// Empty paragraphs are converted in place. Otherwise, the slash token is
	// removed and the new empty block is inserted after the current top-level
	// block, matching Notion-style slash commands.
	if (canConvertInPlace) {
		const mappedBlockStart = tr.mapping.map(blockStart);
		const mappedBlockEnd = tr.mapping.map(blockEnd);
		if (kind === "divider") {
			const inserted = createInsertedBlock(schema, kind);
			if (!inserted) return;
			tr.replaceWith(mappedBlockStart, mappedBlockEnd, inserted.content);
			tr.setSelection(
				TextSelection.create(
					tr.doc,
					mappedBlockStart + inserted.selectionOffset,
				),
			);
			view.dispatch(tr.scrollIntoView());
			view.focus();
			return;
		}
		const node = createEmptyBlock(schema, kind);
		if (!node) return;
		tr.replaceWith(mappedBlockStart, mappedBlockEnd, node);
		const selectionPos = selectionPositionInsideNode(
			tr.doc.nodeAt(mappedBlockStart),
			mappedBlockStart,
		);
		tr.setSelection(TextSelection.create(tr.doc, selectionPos));
		view.dispatch(tr.scrollIntoView());
		view.focus();
		return;
	}

	const insertAt = tr.mapping.map(blockEnd);
	const inserted = createInsertedBlock(schema, kind);
	if (!inserted) return;
	tr.insert(insertAt, inserted.content);
	tr.setSelection(
		TextSelection.create(tr.doc, insertAt + inserted.selectionOffset),
	);
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

export function applyTemplateSlashCommand(
	editor: Editor,
	token: SlashToken,
	templateBody: string,
): boolean {
	const { state, view } = editor;
	const { schema } = state;
	const $from = state.doc.resolve(token.from);
	if ($from.depth === 0) return false;
	const topLevelDepth = Math.min(1, $from.depth);
	const blockStart = $from.before(topLevelDepth);
	const blockEnd = $from.after(topLevelDepth);
	const block = state.doc.nodeAt(blockStart);
	const nodes =
		templateBody.trim().length === 0
			? []
			: trimTrailingEmptyParagraphs(
					(markdownToTiptapDoc(templateBody).content ?? []).map((node) =>
						schema.nodeFromJSON(node),
					),
				);
	const content =
		nodes.length > 0
			? Fragment.fromArray(nodes)
			: Fragment.from(schema.nodes.paragraph.create());
	const canReplaceParagraph =
		block?.type.name === "paragraph" &&
		block.content.size === token.to - token.from;
	const tr = state.tr.delete(token.from, token.to);

	if (canReplaceParagraph) {
		const mappedBlockStart = tr.mapping.map(blockStart);
		const mappedBlockEnd = tr.mapping.map(blockEnd);
		tr.replaceWith(mappedBlockStart, mappedBlockEnd, content);
		tr.setSelection(Selection.near(tr.doc.resolve(mappedBlockStart), 1));
		view.dispatch(tr.scrollIntoView());
		view.focus();
		return true;
	}

	if (nodes.length === 0) {
		view.dispatch(tr.scrollIntoView());
		view.focus();
		return true;
	}

	const insertAt = tr.mapping.map(blockEnd);
	tr.insert(insertAt, content);
	tr.setSelection(Selection.near(tr.doc.resolve(insertAt + content.size), -1));
	view.dispatch(tr.scrollIntoView());
	view.focus();
	return true;
}

function trimTrailingEmptyParagraphs(nodes: PMNode[]) {
	const trimmed = [...nodes];
	while (isEmptyParagraph(trimmed[trimmed.length - 1])) {
		trimmed.pop();
	}
	return trimmed;
}

function isEmptyParagraph(node: PMNode | undefined) {
	return node?.type.name === "paragraph" && node.childCount === 0;
}

function createInsertedBlock(
	schema: Editor["state"]["schema"],
	kind: SlashCommandKind,
): { content: Fragment; selectionOffset: number } | null {
	const node = createEmptyBlock(schema, kind);
	if (!node) return null;
	if (kind === "divider") {
		const paragraph = schema.nodes.paragraph.create();
		return {
			content: Fragment.fromArray([node, paragraph]),
			selectionOffset: node.nodeSize + 1,
		};
	}
	return {
		content: Fragment.from(node),
		selectionOffset: selectionOffsetInsideNode(node),
	};
}

function createEmptyBlock(
	schema: Editor["state"]["schema"],
	kind: SlashCommandKind,
): PMNode | null {
	const paragraph = schema.nodes.paragraph;
	const heading = schema.nodes.heading;
	const bulletList = schema.nodes.bulletList;
	const orderedList = schema.nodes.orderedList;
	const listItem = schema.nodes.listItem;
	const blockquote = schema.nodes.blockquote;
	const horizontalRule = schema.nodes.horizontalRule;

	switch (kind) {
		case "paragraph":
			return paragraph.create();
		case "heading1":
			return heading.create({ level: 1 });
		case "heading2":
			return heading.create({ level: 2 });
		case "heading3":
			return heading.create({ level: 3 });
		case "bulletList":
			return bulletList.create(null, listItem.create(null, paragraph.create()));
		case "orderedList":
			return orderedList.create(
				null,
				listItem.create(null, paragraph.create()),
			);
		case "taskList":
			return bulletList.create(
				null,
				listItem.create({ checked: false }, paragraph.create()),
			);
		case "blockquote":
			return blockquote.create(null, paragraph.create());
		case "divider":
			return horizontalRule.create();
		case "strike":
		case "table":
			return null;
	}
}

function selectionOffsetInsideNode(node: PMNode) {
	if (node.isTextblock) return 1;
	if (node.type.name === "blockquote") return 2;
	if (node.type.name === "bulletList" || node.type.name === "orderedList")
		return 3;
	return 0;
}

function selectionPositionInsideNode(node: PMNode | null, nodeStart: number) {
	if (!node) return nodeStart;
	return nodeStart + selectionOffsetInsideNode(node);
}
