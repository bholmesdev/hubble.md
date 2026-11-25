import type { ReactNode } from "react";
import MingcuteRightLine from "~icons/mingcute/right-line";
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
	const lastActivity = parts.map((part) => part.type).lastIndexOf("activity");
	const workLabel =
		message.status === "streaming" ? "Thinking" : workedFor(message);
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
					<WorkDetails key={part.id} label={workLabel}>
						<ul className="mt-2 space-y-1 ps-5">
							{part.items.map((item) => (
								<li key={item.id}>{item.text}</li>
							))}
							{message.status === "streaming" &&
							parts[lastActivity] === part &&
							activity ? (
								<li>{activity}</li>
							) : null}
						</ul>
					</WorkDetails>
				),
			)}
			{message.status === "streaming" ? (
				lastActivity < 0 && (activity || !parts.length) ? (
					<WorkDetails label="Thinking">
						{activity ? <p className="mt-2 ps-5">{activity}</p> : null}
					</WorkDetails>
				) : null
			) : !parts.length ? (
				<p>No reply received.</p>
			) : null}
		</>
	);
}

function WorkDetails({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<details className="chat-work group/work text-xs text-muted-foreground">
			<summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-xs py-1 outline-hidden transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				<MingcuteRightLine
					aria-hidden="true"
					className="size-3 shrink-0 transition-transform duration-150 ease-out group-open/work:rotate-90 motion-reduce:transition-none"
				/>
				{label}
			</summary>
			{children}
		</details>
	);
}

function workedFor(message: ChatMessage) {
	if (message.startedAt === undefined || message.finishedAt === undefined)
		return "Worked";
	const seconds = Math.max(
		0,
		Math.floor((message.finishedAt - message.startedAt) / 1000),
	);
	return `Worked for ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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
