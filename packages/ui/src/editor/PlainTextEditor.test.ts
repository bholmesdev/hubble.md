import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { plainTextDocFromText, plainTextFromDoc } from "./PlainTextEditor";

describe("plain text conversion", () => {
	it("represents every line as an unformatted paragraph", () => {
		expect(plainTextDocFromText("First\n\n# literal **text**\n")).toEqual({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "First" }] },
				{ type: "paragraph", content: [] },
				{
					type: "paragraph",
					content: [{ type: "text", text: "# literal **text**" }],
				},
				{ type: "paragraph", content: [] },
			],
		});
	});

	it("preserves empty lines and formatting characters", () => {
		const editor = new Editor({
			extensions: [StarterKit],
			content: plainTextDocFromText("First\n\n# literal **text**\n"),
		});

		expect(plainTextFromDoc(editor)).toBe("First\n\n# literal **text**\n");
		editor.destroy();
	});
});
