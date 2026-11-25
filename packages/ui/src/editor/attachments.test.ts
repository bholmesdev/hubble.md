// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vitest";
import { revealAttachment } from "./attachments";

it("reveals the original selection after edits and refuses missing or ambiguous matches", () => {
	const editor = new Editor({
		extensions: [StarterKit],
		content: "<p>Alpha beta</p>",
	});
	const attachment = {
		kind: "selection" as const,
		path: "/a.md",
		text: "beta",
		source: { from: 7, to: 11, text: "beta" },
	};
	expect(revealAttachment(editor, attachment)).toBe(true);
	expect(
		editor.state.doc.textBetween(
			editor.state.selection.from,
			editor.state.selection.to,
		),
	).toBe("beta");
	editor.commands.setContent(
		"<p>New intro</p><p>Alpha <strong>beta</strong></p>",
	);
	expect(revealAttachment(editor, attachment)).toBe(true);
	expect(
		editor.state.doc.textBetween(
			editor.state.selection.from,
			editor.state.selection.to,
		),
	).toBe("beta");
	editor.commands.setContent("<p>beta and beta</p>");
	expect(revealAttachment(editor, attachment)).toBe(false);
	editor.commands.setContent("<p>Gone</p>");
	expect(revealAttachment(editor, attachment)).toBe(false);
	editor.destroy();
});
