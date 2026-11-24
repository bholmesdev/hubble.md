import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatChunkFade } from "./chatChunkFade";

export function ChatMarkdown({
	text,
	streaming = false,
	onOpenLink,
}: {
	text: string;
	streaming?: boolean;
	onOpenLink: (href: string) => void;
}) {
	const [chunks, setChunks] = useState({ text, boundaries: [0], freshFrom: 0 });
	if (chunks.text !== text) {
		const appended = text.startsWith(chunks.text);
		setChunks({
			text,
			boundaries: appended ? [...chunks.boundaries, chunks.text.length] : [0],
			freshFrom: appended ? chunks.text.length : 0,
		});
	}
	return (
		<div className="hubble-markdown chat-markdown min-w-0 break-words leading-relaxed select-text">
			<Markdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={
					streaming
						? [chatChunkFade(text, chunks.boundaries, chunks.freshFrom)]
						: []
				}
				skipHtml
				components={{
					a: ({ href, children }) =>
						href ? (
							<a
								href={href}
								onClick={(event) => {
									event.preventDefault();
									onOpenLink(href);
								}}
							>
								{children}
							</a>
						) : (
							<span>{children}</span>
						),
					img: ({ alt }) => <span>{alt}</span>,
					table: ({ children }) => (
						<div className="overflow-x-auto">
							<table>{children}</table>
						</div>
					),
				}}
			>
				{text}
			</Markdown>
		</div>
	);
}
