// @vitest-environment happy-dom
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { type ChatAttachment, chatInput } from "../desktopApi/chat";
import { ChatComposer } from "./ChatComposer";

it.each([
	false,
	true,
])("preserves typed-text undo when a quote is attached externally (multiline: %s)", async (multiline) => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let draft: { text: string; attachments: ChatAttachment[] } = {
		text: "",
		attachments: [],
	};
	function render() {
		root.render(
			<ChatComposer
				{...draft}
				onEdit={(text, attachments) => {
					draft = { text, attachments };
					render();
				}}
				onReveal={vi.fn()}
			/>,
		);
	}
	try {
		await act(async () => render());
		const input = host.querySelector<HTMLElement & { editor: Editor }>(
			'[role="textbox"]',
		);
		if (!input) throw new Error("Missing composer");
		const editor = input.editor;
		const typed = multiline ? "Hello\nWorld" : "Hello";
		await act(async () =>
			editor.commands.insertContent([
				{ type: "text", text: "Hello" },
				...(multiline
					? [{ type: "hardBreak" }, { type: "text", text: "World" }]
					: []),
			]),
		);
		await act(async () => {
			draft = {
				...draft,
				attachments: [
					{
						id: "quote",
						kind: "selection",
						path: "/notes/a.md",
						text: "A passage",
						offset: typed.length,
					},
				],
			};
			render();
		});
		const nodes = editor.getJSON().content?.[0].content;
		expect(nodes?.[nodes.length - 1]).toMatchObject({
			type: "quote",
			attrs: { id: "quote" },
		});
		await act(async () => editor.commands.undo());
		expect(draft.text).toBe("");
		expect(draft.attachments).toMatchObject([{ id: "quote", offset: 0 }]);
		await act(async () => editor.commands.redo());
		expect(draft.text).toBe(typed);
		expect(draft.attachments).toMatchObject([
			{ id: "quote", offset: typed.length },
		]);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

it.each([
	"empty",
	"paragraph",
	"hardBreak",
])("keeps a quote in an empty paragraph when typing and preparing model input (initial: %s)", async (initial) => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let text = "";
	let attachments: ChatAttachment[] = [];
	function render() {
		root.render(
			<ChatComposer
				text={text}
				attachments={attachments}
				onReveal={vi.fn()}
				onEdit={(nextText, nextAttachments) => {
					text = nextText;
					attachments = nextAttachments;
					render();
				}}
			/>,
		);
	}
	try {
		await act(async () => render());
		const input = host.querySelector<HTMLElement & { editor: Editor }>(
			'[role="textbox"]',
		);
		if (!input) throw new Error("Missing composer");
		if (initial !== "empty") {
			await act(async () => input.editor.commands.insertContent("Before"));
			await act(async () =>
				initial === "hardBreak"
					? input.editor.commands.setHardBreak()
					: input.editor.commands.splitBlock(),
			);
		}
		const offset = text.length;
		await act(async () => {
			attachments = [
				{
					id: "first",
					kind: "selection",
					path: "/notes/a.md",
					text: "First passage",
					offset,
				},
			];
			render();
		});
		const paragraphs = input.editor.getJSON().content;
		const nodes = paragraphs?.[paragraphs.length - 1].content;
		expect(nodes?.[nodes.length - 1]).toMatchObject({
			type: "quote",
			attrs: { id: "first" },
		});
		await act(async () =>
			input.editor.commands.insertContentAt(
				input.editor.state.doc.content.size - 1,
				"Explain this",
			),
		);
		expect(attachments).toMatchObject([{ id: "first", offset }]);
		const sent = chatInput([
			{ id: "message", role: "user", status: "complete", text, attachments },
		])[0].content;
		expect(sent).toContain("First passage");
		expect(sent).toContain("Explain this");
		expect(sent.indexOf("First passage")).toBeLessThan(
			sent.indexOf("Explain this"),
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

it.each([
	"single",
	"hardBreak",
	"paragraph",
])("preserves typed undo and quote anchors after voice updates (%s)", async (kind) => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let text = "";
	let attachments: ChatAttachment[] = [];
	function render() {
		root.render(
			<ChatComposer
				text={text}
				attachments={attachments}
				onReveal={vi.fn()}
				onEdit={(nextText, nextAttachments) => {
					text = nextText;
					attachments = nextAttachments;
					render();
				}}
			/>,
		);
	}
	try {
		await act(async () => render());
		const input = host.querySelector<HTMLElement & { editor: Editor }>(
			'[role="textbox"]',
		);
		if (!input) throw new Error("Missing composer");
		if (kind === "paragraph") {
			await act(async () => input.editor.commands.insertContent("Hello"));
			await act(async () => input.editor.commands.splitBlock());
			await act(async () =>
				input.editor.view.dispatch(closeHistory(input.editor.state.tr)),
			);
			await act(async () => input.editor.commands.insertContent("World"));
		} else {
			await act(async () =>
				input.editor.commands.insertContent([
					{ type: "text", text: "Hello" },
					...(kind === "hardBreak"
						? [{ type: "hardBreak" }, { type: "text", text: "World" }]
						: []),
				]),
			);
		}
		const typed = text;
		await act(async () => {
			attachments = [
				{
					id: "quote",
					kind: "selection",
					path: "/notes/a.md",
					text: "A passage",
					offset: typed.length,
				},
			];
			render();
		});
		await act(async () => {
			text = `${typed} voice`;
			render();
		});
		await act(async () => input.editor.commands.undo());
		const baseline = kind === "paragraph" ? "Hello\n" : "";
		expect(text).toBe(`${baseline} voice`);
		expect(attachments).toMatchObject([
			{ id: "quote", offset: baseline.length },
		]);
		await act(async () => input.editor.commands.redo());
		expect(text).toBe(`${typed} voice`);
		expect(attachments).toMatchObject([{ id: "quote", offset: typed.length }]);
		await act(async () => {
			text = `${typed} revised voice`;
			attachments = attachments.map((attachment) => ({
				...attachment,
				offset: typed.length + 8,
			}));
			render();
		});
		await act(async () =>
			input.editor.commands.insertContentAt(
				input.editor.state.doc.content.size - 1,
				"!",
			),
		);
		expect(text).toBe(`${typed} revised voice!`);
		expect(attachments).toMatchObject([
			{ id: "quote", offset: typed.length + 8 },
		]);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
