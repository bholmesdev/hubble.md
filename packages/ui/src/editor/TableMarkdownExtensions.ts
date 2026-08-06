import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

// GFM table cells hold inline content. Paragraphs wrap that content; block
// images are the one extra node we can write back without losing structure.
export const MarkdownTableCell = TableCell.extend({
	content: "tableCellContent+",
});

export const MarkdownTableHeader = TableHeader.extend({
	content: "tableCellContent+",
});
