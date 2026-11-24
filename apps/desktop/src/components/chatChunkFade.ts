import type { Element, Root } from "hast";

/** Split rendered text at received chunk boundaries without splitting the Markdown source. */
export function chatChunkFade(
	source: string,
	boundaries: number[],
	freshFrom: number,
) {
	return () => (tree: Root) => {
		function wrap(parent: Root | Element) {
			for (let index = 0; index < parent.children.length; index++) {
				const child = parent.children[index];
				if (child.type === "element") {
					wrap(child);
					continue;
				}
				if (child.type !== "text" || !child.value.trim()) continue;
				const start =
					child.position?.start.offset ?? parent.position?.start.offset ?? 0;
				const literal = source.indexOf(child.value.trimEnd(), start);
				const base = literal >= 0 ? literal : start;
				const cuts = [
					0,
					...boundaries
						.map((offset) => offset - base)
						.filter((offset) => offset > 0 && offset < child.value.length),
					child.value.length,
				];
				const spans = cuts.slice(0, -1).map(
					(from, index): Element => ({
						type: "element",
						tagName: "span",
						properties: {
							"data-stream-chunk": base + from,
							className: base + from >= freshFrom ? ["chat-chunk-enter"] : [],
						},
						children: [
							{
								type: "text",
								value: child.value.slice(from, cuts[index + 1]),
							},
						],
					}),
				);
				parent.children.splice(index, 1, ...spans);
				index += spans.length - 1;
			}
		}
		wrap(tree);
	};
}
