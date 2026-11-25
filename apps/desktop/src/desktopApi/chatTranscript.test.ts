import { expect, it } from "vitest";
import { editChatDraft } from "./chatTranscript";

it("keeps markers outside completed words and follows edits before the marker", () => {
	let chat = editChatDraft(
		{
			messages: [],
			model: "",
			draft: "read this sect",
			attachments: [
				{
					id: "quote",
					kind: "selection",
					path: "/a.md",
					text: "Quote",
					offset: 14,
				},
			],
		},
		"Read this section. Then compare.",
	);
	expect(chat.attachments?.[0].offset).toBe(18);
	chat = editChatDraft(chat, `Please ${chat.draft}`);
	expect(chat.attachments?.[0].offset).toBe(25);
	chat = editChatDraft(chat, "");
	expect(chat.attachments?.[0].offset).toBe(0);
});
