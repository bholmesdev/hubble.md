import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

export const MarkdownTableCell = TableCell.extend({
	content: "tableCellContent+",
});

export const MarkdownTableHeader = TableHeader.extend({
	content: "tableCellContent+",
});
