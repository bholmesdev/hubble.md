import {
	Mark,
	markInputRule,
	markPasteRule,
	mergeAttributes,
} from "@tiptap/core";

const inputRegex = /(^|[^`])`([^`]+)`(?!`)$/;
const pasteRegex = /(^|[^`])`([^`]+)`(?!`)/g;

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		code: {
			setCode: () => ReturnType;
			toggleCode: () => ReturnType;
			unsetCode: () => ReturnType;
		};
	}
}

/**
 * Inline code keeps its normal Markdown behavior, but does not exclude other
 * marks, so a review span can cover code and surrounding text together.
 */
export const InlineCodeExtension = Mark.create({
	name: "code",
	excludes: "",
	code: true,
	exitable: true,

	parseHTML() {
		return [{ tag: "code" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["code", mergeAttributes(HTMLAttributes), 0];
	},

	addCommands() {
		return {
			setCode:
				() =>
				({ commands }) =>
					commands.setMark(this.name),
			toggleCode:
				() =>
				({ commands }) =>
					commands.toggleMark(this.name),
			unsetCode:
				() =>
				({ commands }) =>
					commands.unsetMark(this.name),
		};
	},

	addKeyboardShortcuts() {
		return {
			"Mod-e": () => this.editor.commands.toggleCode(),
		};
	},

	addInputRules() {
		return [markInputRule({ find: inputRegex, type: this.type })];
	},

	addPasteRules() {
		return [markPasteRule({ find: pasteRegex, type: this.type })];
	},
});
