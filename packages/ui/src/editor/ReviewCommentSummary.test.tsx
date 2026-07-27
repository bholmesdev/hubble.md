// @vitest-environment happy-dom

import { markdownToTiptapDoc, ReviewMarkExtension } from "@hubble.md/editor";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement, Fragment, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ReviewCommentSlot,
	usePublishReviewComments,
} from "./ReviewCommentSlot";
import type { ReviewCommentSummaryProps } from "./ReviewCommentSummary";
import type { ReviewComment } from "./reviewComments";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const editors: Editor[] = [];
const roots: Root[] = [];

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	for (const editor of editors) editor.destroy();
	editors.length = 0;
	document.body.replaceChildren();
});

describe("ReviewCommentSummary", () => {
	it("renders nothing until an app provides a toolbar slot", () => {
		const { editor } = setup("{==first==}{>>Note one<<}{#c1}");
		render(editor, [], { withSlot: false });
		expect(document.querySelector("button")).toBeNull();
	});

	it("teaches the feature when the document has no comments", async () => {
		const { editor } = setup("plain text");
		render(editor, []);

		const trigger = document.querySelector("button");
		expect(trigger?.getAttribute("aria-label")).toBe("Comments");
		expect(trigger?.textContent).toBe("");
		await act(async () => {
			trigger?.click();
		});

		const panel = document.querySelector("[data-review-comment-summary]");
		expect(panel?.textContent).toContain("No comments yet");
		expect(panel?.textContent).toContain("Highlight any text");
		// Filters and the handoff would both be empty gestures here.
		expect(panel?.querySelector('[role="tab"]')).toBeNull();
		expect(findCopyButton()).toBeNull();
	});

	it("lists every thread and opens the one that is clicked", async () => {
		const { editor, comments } = setup(
			"{==first==}{>>Note one<<}{#c1}\n\n{==second==}{>>Note two<<}{#c2}",
		);
		const onOpenComment = vi.fn();
		render(editor, comments, { onOpenComment });

		await act(async () => {
			document.querySelector("button")?.click();
		});

		const rows = threadRows();
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain("Note one");
		await act(async () => {
			rows[1]?.click();
		});

		expect(onOpenComment).toHaveBeenCalledWith("c2");
	});

	it("filters the list through the unresolved, resolved, and all tabs", async () => {
		const { editor, comments } = setup(
			'{==first==}{>>Open note<<}{#c1}\n\n{==second==}{>>Closed note<<}{#c2}<!-- hubble-review:{"v":1,"replies":[],"resolved":true}-->',
		);
		render(editor, comments);
		await act(async () => {
			document.querySelector("button")?.click();
		});

		expect(selectedTab()).toBe("Unresolved");
		expect(threadRows()).toHaveLength(1);
		expect(threadRows()[0]?.textContent).toContain("Open note");

		await act(async () => {
			tab("Resolved")?.click();
		});
		expect(threadRows()).toHaveLength(1);
		expect(threadRows()[0]?.textContent).toContain("Closed note");

		await act(async () => {
			tab("All")?.click();
		});
		expect(threadRows()).toHaveLength(2);
	});

	it("always opens on unresolved, even with nothing left to act on", async () => {
		const { editor, comments } = setup(
			'{==first==}{>>Closed note<<}{#c1}<!-- hubble-review:{"v":1,"replies":[],"resolved":true}-->',
		);
		render(editor, comments);
		await act(async () => {
			document.querySelector("button")?.click();
		});

		expect(selectedTab()).toBe("Unresolved");
		expect(threadRows()).toHaveLength(0);
		expect(
			document.querySelector("[data-review-comment-summary]")?.textContent,
		).toContain("No unresolved comments");
	});

	it("says so when a tab has nothing to show", async () => {
		const { editor, comments } = setup("{==first==}{>>Open note<<}{#c1}");
		render(editor, comments);
		await act(async () => {
			document.querySelector("button")?.click();
		});
		await act(async () => {
			tab("Resolved")?.click();
		});

		expect(threadRows()).toHaveLength(0);
		expect(
			document.querySelector("[data-review-comment-summary]")?.textContent,
		).toContain("No resolved comments");
	});

	it("copies one prompt covering every unresolved thread", async () => {
		const { editor, comments } = setup(
			"{==first==}{>>Note one<<}{#c1}\n\n{==second==}{>>Note two<<}{#c2}",
		);
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		render(editor, comments);

		await act(async () => {
			document.querySelector("button")?.click();
		});
		const copy = findCopyButton();
		await act(async () => {
			copy?.click();
		});

		expect(writeText).toHaveBeenCalledWith(
			"Address the unresolved comments in /notes/plan.md",
		);
	});

	it("resolves, copies, and deletes a thread from its row", async () => {
		const { editor, comments } = setup(
			"{==first==}{>>Note one<<}{#c1}\n\n{==second==}{>>Note two<<}{#c2}",
		);
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		render(editor, comments);
		await act(async () => {
			document.querySelector("button")?.click();
		});

		await act(async () => {
			rowAction(0, "Copy agent prompt")?.click();
		});
		expect(writeText).toHaveBeenCalledWith(
			"Address comment c1 in /notes/plan.md",
		);

		await act(async () => {
			rowAction(0, "Resolve")?.click();
		});
		expect(markAttrs(editor, "c1")?.resolved).toBe(true);

		await act(async () => {
			rowAction(1, "Delete comment")?.click();
		});
		expect(markAttrs(editor, "c2")).toBeUndefined();
	});

	it("moves one tab stop into the grid and navigates it with arrows", async () => {
		const { editor, comments } = setup(
			"{==first==}{>>Note one<<}{#c1}\n\n{==second==}{>>Note two<<}{#c2}",
		);
		render(editor, comments);
		await act(async () => {
			document.querySelector("button")?.click();
		});

		// Exactly one cell is reachable by Tab; arrows move the rest.
		expect(tabbableCells()).toHaveLength(1);
		expect(tabbableCells()[0]?.dataset.row).toBe("0");
		expect(tabbableCells()[0]?.dataset.col).toBe("0");

		const grid = document.querySelector<HTMLElement>('[role="grid"]');
		await act(async () => {
			threadRows()[0]?.focus();
		});
		await act(async () => {
			press(grid, "ArrowDown");
		});
		expect(document.activeElement).toBe(threadRows()[1]);

		await act(async () => {
			press(grid, "ArrowRight");
		});
		expect(document.activeElement?.getAttribute("aria-label")).toBe("Resolve");

		// Column is held while moving between rows, so a run of resolves needs no
		// re-aiming.
		await act(async () => {
			press(grid, "ArrowUp");
		});
		expect(document.activeElement).toBe(rowAction(0, "Resolve"));

		await act(async () => {
			press(grid, "End");
		});
		expect(document.activeElement).toBe(rowAction(1, "Resolve"));
	});

	it("disables the handoff once every thread is resolved", async () => {
		const { editor, comments } = setup(
			'{==first==}{>>Note one<<}{#c1}<!-- hubble-review:{"v":1,"replies":[],"resolved":true}-->',
		);
		expect(comments[0]?.attrs.resolved).toBe(true);
		render(editor, comments);

		await act(async () => {
			document.querySelector("button")?.click();
		});

		expect(findCopyButton()?.disabled).toBe(true);
	});
});

/** The button that opens each thread: column 0 of every grid row. */
function threadRows() {
	return [
		...document.querySelectorAll<HTMLButtonElement>(
			'[data-review-comment-summary] [role="row"] [data-col="0"]',
		),
	];
}

function tabbableCells() {
	return [
		...document.querySelectorAll<HTMLElement>('[role="grid"] [tabindex="0"]'),
	];
}

function press(target: Element | null, key: string) {
	target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function markAttrs(editor: Editor, id: string) {
	let attrs: Record<string, unknown> | undefined;
	editor.state.doc.descendants((node) => {
		for (const mark of node.marks) {
			if (mark.type.name === "reviewMark" && mark.attrs.id === id) {
				attrs = mark.attrs;
				return false;
			}
		}
		return true;
	});
	return attrs;
}

function rowAction(row: number, label: string) {
	return document.querySelector<HTMLButtonElement>(
		`[data-review-comment-summary] [data-row="${row}"][aria-label="${label}"]`,
	);
}

function tab(label: string) {
	return [
		...document.querySelectorAll<HTMLElement>(
			'[data-review-comment-summary] [role="tab"]',
		),
	].find((el) => el.textContent === label);
}

function selectedTab() {
	return document.querySelector<HTMLElement>(
		'[data-review-comment-summary] [role="tab"][data-active]',
	)?.textContent;
}

function findCopyButton() {
	return document.querySelector<HTMLButtonElement>(
		"[data-review-copy-all-prompt]",
	);
}

function setup(markdown: string) {
	const editor = new Editor({
		element: document.createElement("div"),
		extensions: [StarterKit, ReviewMarkExtension],
		content: markdownToTiptapDoc(markdown),
	});
	editors.push(editor);
	return { editor, comments: collectComments(editor) };
}

/** Mirrors what the popover publishes, so the summary is exercised with the
 * same shape it receives in the app. */
function collectComments(editor: Editor) {
	const comments: ReviewComment[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (!node.isText) return true;
		const mark = node.marks.find(
			(candidate) =>
				candidate.type.name === "reviewMark" &&
				candidate.attrs.type === "reviewComment" &&
				typeof candidate.attrs.id === "string",
		);
		if (!mark) return false;
		const last = comments[comments.length - 1];
		if (last?.id === mark.attrs.id && last.to === pos) {
			last.to = pos + node.nodeSize;
			return false;
		}
		comments.push({
			id: mark.attrs.id,
			from: pos,
			to: pos + node.nodeSize,
			attrs: mark.attrs as ReviewComment["attrs"],
		});
		return false;
	});
	return comments;
}

/** Mirrors the app wiring: the editor publishes, and the toolbar slot renders
 * whatever was published. */
function render(
	editor: Editor,
	comments: ReviewComment[],
	{ withSlot = true, ...props }: Record<string, unknown> = {},
) {
	const rootEl = document.createElement("div");
	document.body.append(rootEl);
	const root = createRoot(rootEl);
	roots.push(root);
	act(() => {
		root.render(
			createElement(
				Fragment,
				null,
				createElement(Publisher, {
					editor,
					filePath: "/notes/plan.md",
					comments,
					onOpenComment: () => {},
					...props,
				}),
				withSlot ? createElement(ReviewCommentSlot) : null,
			),
		);
	});
}

function Publisher(props: ReviewCommentSummaryProps) {
	usePublishReviewComments(props);
	return null;
}
