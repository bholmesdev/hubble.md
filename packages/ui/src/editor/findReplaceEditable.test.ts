// @vitest-environment happy-dom

import { FindExtension } from "@hubble.md/editor";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
});

function createEditor(editable: boolean) {
	const editor = new Editor({
		extensions: [StarterKit, FindExtension],
		content: "<p>alpha beta alpha</p>",
		editable,
	});
	editors.push(editor);
	editor.commands.setFindQuery("alpha");
	return editor;
}

// Read-only documents (the changelog note, for one) still mount the find bar,
// and commands dispatch straight to the view, so the guard lives in the command.
describe("replace on a read-only document", () => {
	it("refuses to replace the active match", () => {
		const editor = createEditor(false);

		expect(editor.commands.replaceFindMatch("gamma")).toBe(false);
		expect(editor.getText()).toBe("alpha beta alpha");
	});

	it("refuses to replace every match", () => {
		const editor = createEditor(false);

		expect(editor.commands.replaceAllFindMatches("gamma")).toBe(false);
		expect(editor.getText()).toBe("alpha beta alpha");
	});

	it("still replaces once the document is editable", () => {
		const editor = createEditor(true);

		expect(editor.commands.replaceAllFindMatches("gamma")).toBe(true);
		expect(editor.getText()).toBe("gamma beta gamma");
	});
});
