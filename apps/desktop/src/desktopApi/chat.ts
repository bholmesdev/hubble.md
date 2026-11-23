export type ChatAccount = {
	connected: boolean;
	sharing: boolean;
	label: string | null;
	expiresAt: number | null;
};

export type ChatModel = { slug: string; name: string };
export type ChatQuote = { id: string; source: string; text: string };
export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	text: string;
	quotes: ChatQuote[];
	status: "complete" | "streaming" | "stopped" | "failed";
};

export type ChatRequest = {
	id: string;
	model: string;
	messages: ChatMessage[];
};

export type ChatResult = {
	status: "complete" | "stopped" | "failed";
	text: string;
	error?: string;
};

export type ChatDelta = { id: string; text: string };

export const CHAT_CONTEXT_LIMIT = 80_000;

export function chatInput(messages: ChatMessage[]) {
	return messages
		.filter((message) => message.status === "complete")
		.map((message) => ({
			role: message.role,
			content: [
				message.text,
				...message.quotes.map(
					(quote, index) =>
						`Quoted document passage ${index + 1} (${quote.source}):\n${quote.text}`,
				),
			].join("\n\n"),
		}));
}
