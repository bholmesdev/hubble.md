export type EditorAttachment = {
	kind: "selection" | "thread";
	path: string;
	text: string;
	threadId?: string;
	comments?: { author: "human" | "agent"; body: string }[];
};
