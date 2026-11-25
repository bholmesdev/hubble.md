import { useStoreValue } from "@simplestack/store/react";
import { useEffect, useState } from "react";
import MingcuteRightLine from "~icons/mingcute/right-line";
import { type ChatMessage, chatResponseInput } from "../desktopApi/chat";
import { chatPayloads, loadChatPayloads } from "../store/chatDebug";

export function ChatPayloads({
	requestId,
	message,
	history,
}: {
	requestId?: string;
	message: ChatMessage;
	history: ChatMessage[];
}) {
	const role = message.role;
	const payloads = useStoreValue(chatPayloads);
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (expanded && requestId) void loadChatPayloads(requestId);
	}, [expanded, requestId]);
	const entries = (payloads[requestId ?? ""] ?? []).filter((item) =>
		role === "user"
			? item.direction === "request" && item.round === 1
			: item.direction !== "request" || item.round > 1,
	);
	return (
		<details
			className="group/payload text-xs text-muted-foreground"
			onToggle={(event) => setExpanded(event.currentTarget.open)}
		>
			<summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-xs py-1 outline-hidden hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				<MingcuteRightLine
					aria-hidden="true"
					className="size-3 shrink-0 transition-transform duration-150 ease-out group-open/payload:rotate-90 motion-reduce:transition-none"
				/>
				{entries.length
					? role === "user"
						? "Request payload"
						: "API payloads"
					: role === "user"
						? "Saved input"
						: "Saved reply"}
			</summary>
			{expanded ? (
				entries.length ? (
					<div className="mt-2 min-w-0 space-y-3">
						{entries.map((entry) => (
							<div key={`${entry.round}-${entry.direction}`}>
								<p className="mb-1">
									{entry.direction === "request"
										? "Request"
										: entry.direction === "response"
											? "Response"
											: "Error"}{" "}
									{entry.round}
								</p>
								<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground select-text">
									{JSON.stringify(entry.body, null, 2)}
								</pre>
							</div>
						))}
					</div>
				) : (
					<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground select-text">
						{JSON.stringify(
							role === "user"
								? chatResponseInput(history)
								: message.context?.length
									? message.context
									: {
											role: message.role,
											text: message.text,
											status: message.status,
										},
							null,
							2,
						)}
					</pre>
				)
			) : null}
		</details>
	);
}
