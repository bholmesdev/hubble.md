// @vitest-environment happy-dom

import { Editor, type JSONContent } from "@tiptap/core";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
	applySlashCommand,
	applyTemplateSlashCommand,
	findSlashToken,
	type SlashToken,
} from "./slashCommandActions";

const editors: Editor[] = [];
const CheckedListItem = ListItem.extend({
	addAttributes() {
		return {
			checked: {
				default: null,
			},
		};
	},
});

afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
});

describe("slash command token detection", () => {
	it("detects slash commands at the start of a text block", () => {
		const editor = createEditor(docWithParagraph("/h"));

		expect(findSlashToken(editor)).toMatchObject({ query: "h" });
	});

	it("detects slash commands after whitespace", () => {
		const editor = createEditor(docWithParagraph("hello /h"));

		expect(findSlashToken(editor)).toMatchObject({ query: "h" });
	});

	it("does not detect slash commands inside phrases or paths", () => {
		expect(findSlashToken(createEditor(docWithParagraph("hello/there")))).toBe(
			null,
		);
		expect(findSlashToken(createEditor(docWithParagraph("docs/foo")))).toBe(
			null,
		);
	});
});

describe("slash command document actions", () => {
	it("converts an empty slash paragraph in place", () => {
		const editor = createEditor(docWithParagraph("/h2"));
		const token = expectSlashToken(editor);

		applySlashCommand(editor, token, "heading2");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{ type: "heading", attrs: { level: 2 } },
				{ type: "paragraph" },
			],
		});
	});

	it("inserts a new block after non-empty slash paragraphs", () => {
		const editor = createEditor(docWithParagraph("text /h2"));
		const token = expectSlashToken(editor);

		applySlashCommand(editor, token, "heading2");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "text " }] },
				{ type: "heading", attrs: { level: 2 } },
				{ type: "paragraph" },
			],
		});
	});

	it("creates unchecked task list items", () => {
		const editor = createEditor(docWithParagraph("/todo"));
		const token = expectSlashToken(editor);

		applySlashCommand(editor, token, "taskList");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							attrs: { checked: false },
							content: [{ type: "paragraph" }],
						},
					],
				},
				{ type: "paragraph" },
			],
		});
	});

	it("inserts a paragraph after a divider", () => {
		const editor = createEditor(docWithParagraph("/divider"));
		const token = expectSlashToken(editor);

		applySlashCommand(editor, token, "divider");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [{ type: "horizontalRule" }, { type: "paragraph" }],
		});
	});

	it("toggles strikethrough for following typed text", () => {
		const editor = createEditor(docWithParagraph("/strike"));
		const token = expectSlashToken(editor);

		applySlashCommand(editor, token, "strike");

		editor.commands.insertContent("next");
		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "next",
							marks: [{ type: "strike" }],
						},
					],
				},
			],
		});
	});

	it("replaces a slash-only paragraph with multiple template blocks", () => {
		const editor = createEditor(docWithParagraph("/template"));
		const token = expectSlashToken(editor);

		applyTemplateSlashCommand(editor, token, "# Agenda\n\n- one\n- two");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "Agenda" }],
				},
				{
					type: "bulletList",
					content: [
						{
							attrs: { checked: null },
							type: "listItem",
							content: [
								{ type: "paragraph", content: [{ type: "text", text: "one" }] },
							],
						},
						{
							attrs: { checked: null },
							type: "listItem",
							content: [
								{ type: "paragraph", content: [{ type: "text", text: "two" }] },
							],
						},
					],
				},
				{ type: "paragraph" },
			],
		});
	});

	it("inserts template blocks after a non-empty slash paragraph", () => {
		const editor = createEditor(docWithParagraph("Intro /template"));
		const token = expectSlashToken(editor);

		applyTemplateSlashCommand(editor, token, "## Details\n\nBody");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Intro " }] },
				{
					type: "heading",
					attrs: { level: 2 },
					content: [{ type: "text", text: "Details" }],
				},
				{ type: "paragraph", content: [{ type: "text", text: "Body" }] },
			],
		});
	});

	it("removes the slash token for property-only templates", () => {
		const editor = createEditor(docWithParagraph("Intro /template"));
		const token = expectSlashToken(editor);

		applyTemplateSlashCommand(editor, token, "");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Intro " }] },
			],
		});
	});
});

function createEditor(content: JSONContent) {
	const editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({
				bulletList: false,
				orderedList: false,
				listItem: false,
			}),
			BulletList,
			OrderedList,
			CheckedListItem,
		],
		content,
	});
	editors.push(editor);
	Object.defineProperty(editor, "isFocused", { value: true });
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
		),
	);
	return editor;
}

function expectSlashToken(editor: Editor): SlashToken {
	const token = findSlashToken(editor);
	expect(token).not.toBeNull();
	if (!token) throw new Error("Expected slash token");
	return token;
}

function docWithParagraph(text: string): JSONContent {
	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: text ? [{ type: "text", text }] : undefined,
			},
		],
	};
}
