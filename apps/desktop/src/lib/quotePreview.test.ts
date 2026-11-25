import { expect, it } from "vitest";
import { quotePreview } from "./quotePreview";

it("flattens Markdown into a paragraph while preserving labels and adjacent formatted text", () => {
	expect(
		quotePreview(
			"## Practice Prompt\n\n- Distributed **systems** and [[notes/system-design|System Design]]\n- [Further reading](https://example.com) with spe**ci**fic `code`\n\n> *Brief* reply",
		),
	).toBe(
		"Practice Prompt Distributed systems and System Design Further reading with specific code Brief reply",
	);
});
