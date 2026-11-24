import { type ChatMessage, chatActivities } from "../desktopApi/chat";
import { ChatMarkdown } from "./ChatMarkdown";
import "./ChatMarkdown.css";

type Activity = ReturnType<typeof chatActivities>[number];
type Part =
	| { type: "text"; id: string; text: string }
	| { type: "activity"; id: string; items: Activity[] };

export function ChatReply({
	message,
	activity,
	onOpenLink,
}: {
	message: ChatMessage;
	activity?: string;
	onOpenLink: (href: string) => void;
}) {
	const parts = replyParts(message);
	return (
		<>
			{parts.map((part) =>
				part.type === "text" ? (
					<ChatMarkdown
						key={part.id}
						text={part.text}
						streaming={message.status === "streaming" && part.id === "stream"}
						onOpenLink={onOpenLink}
					/>
				) : (
					<details key={part.id} className="text-xs text-muted-foreground">
						<summary>Workspace activity</summary>
						<ul className="mt-2 space-y-1">
							{part.items.map((item) => (
								<li key={item.id}>{item.text}</li>
							))}
						</ul>
					</details>
				),
			)}
			{message.status === "streaming" ? (
				activity || !parts.length ? (
					<output className="block text-xs text-muted-foreground">
						{activity || "Thinking…"}
					</output>
				) : null
			) : !parts.length ? (
				<p>No reply received.</p>
			) : null}
		</>
	);
}

/** Response items keep completed text and tools in order; the stream supplies only the unfinished tail. */
function replyParts(message: ChatMessage): Part[] {
	const parts: Part[] = [];
	const context = message.context ?? [];
	const activities = new Map(
		chatActivities(context).map((item) => [item.id, item]),
	);
	const texts: string[] = [];
	for (const [index, item] of context.entries()) {
		if (item.type === "message") {
			const text = Array.isArray(item.content)
				? item.content
						.map((content) =>
							content &&
							typeof content === "object" &&
							"text" in content &&
							typeof content.text === "string"
								? content.text
								: "",
						)
						.join("")
				: typeof item.content === "string"
					? item.content
					: "";
			if (text) {
				parts.push({
					type: "text",
					id: String(item.id ?? `text-${index}`),
					text,
				});
				texts.push(text);
			}
		} else if (item.type === "function_call_output") {
			const activity = activities.get(String(item.call_id));
			if (!activity) continue;
			const previous = parts[parts.length - 1];
			if (previous?.type === "activity") previous.items.push(activity);
			else parts.push({ type: "activity", id: activity.id, items: [activity] });
		}
	}
	let offset = 0;
	for (const text of texts) {
		if (message.text.startsWith(text, offset)) offset += text.length;
		else if (message.text.startsWith(`\n\n${text}`, offset))
			offset += text.length + 2;
		else {
			offset = message.text.length;
			break;
		}
	}
	const tail = message.text.slice(offset).replace(/^\n\n/, "");
	if (tail) parts.push({ type: "text", id: "stream", text: tail });
	return parts;
}
