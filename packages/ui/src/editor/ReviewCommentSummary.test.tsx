// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewCommentSummary } from "./ReviewCommentSummary";
import type { ReviewThread } from "./reviewComments";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const roots: Root[] = [];

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	document.body.replaceChildren();
});

const OPEN: ReviewThread = {
	id: "c1",
	anchor: "first",
	body: "Note one",
	resolved: false,
};
const CLOSED: ReviewThread = {
	id: "c2",
	anchor: "second",
	body: "Note two",
	resolved: true,
};
const ALSO_OPEN: ReviewThread = { ...CLOSED, resolved: false };

describe("ReviewCommentSummary", () => {
	it("opens from a menu item trigger", async () => {
		render([], {
			trigger: createElement("div"),
			triggerChildren: "Comments",
			triggerNativeButton: false,
			triggerRole: "menuitem",
		});

		const trigger = document.querySelector<HTMLElement>('[role="menuitem"]');
		expect(trigger?.textContent).toBe("Comments");
		await act(async () => trigger?.click());
		expect(panelText()).toContain("No comments yet");
	});

	it("teaches the feature when the document has no comments", async () => {
		render([]);

		const trigger = document.querySelector("button");
		expect(trigger?.getAttribute("aria-label")).toBe("Comments");
		expect(trigger?.textContent).toBe("");
		await act(async () => {
			trigger?.click();
		});

		expect(panelText()).toContain("No comments yet");
		expect(panelText()).toContain("Highlight any text");
		// Filters and the handoff would both be empty gestures here.
		expect(
			document.querySelector('[data-review-comment-summary] [role="tab"]'),
		).toBeNull();
		expect(findCopyButton()).toBeNull();
	});

	it("lists every thread and opens the one that is clicked", async () => {
		const onCommand = vi.fn();
		render([OPEN, ALSO_OPEN], { onCommand });
		await open();

		const rows = threadRows();
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain("Note one");
		await act(async () => {
			rows[1]?.click();
		});

		expect(onCommand).toHaveBeenCalledWith("open", "c2");
	});

	it("filters the list through the unresolved, resolved, and all tabs", async () => {
		render([OPEN, CLOSED]);
		await open();

		expect(selectedTab()).toBe("Unresolved");
		expect(threadRows()).toHaveLength(1);
		expect(threadRows()[0]?.textContent).toContain("Note one");

		await act(async () => {
			tab("Resolved")?.click();
		});
		expect(threadRows()).toHaveLength(1);
		expect(threadRows()[0]?.textContent).toContain("Note two");

		await act(async () => {
			tab("All")?.click();
		});
		expect(threadRows()).toHaveLength(2);
	});

	it("always opens on unresolved, even with nothing left to act on", async () => {
		render([CLOSED]);
		await open();

		expect(selectedTab()).toBe("Unresolved");
		expect(threadRows()).toHaveLength(0);
		expect(panelText()).toContain("No unresolved comments");
	});

	it("says so when a tab has nothing to show", async () => {
		render([OPEN]);
		await open();
		await act(async () => {
			tab("Resolved")?.click();
		});

		expect(threadRows()).toHaveLength(0);
		expect(panelText()).toContain("No resolved comments");
	});

	it("copies one prompt covering every unresolved thread", async () => {
		const writeText = stubClipboard();
		render([OPEN]);
		await open();

		await act(async () => {
			findCopyButton()?.click();
		});

		expect(writeText).toHaveBeenCalledWith(
			"Address the unresolved comments in /notes/plan.md",
		);
	});

	it("disables the handoff once every thread is resolved", async () => {
		render([CLOSED]);
		await open();

		expect(findCopyButton()?.disabled).toBe(true);
	});

	it("commands resolve and delete from a row, and copies its own prompt", async () => {
		const writeText = stubClipboard();
		const onCommand = vi.fn();
		render([OPEN, ALSO_OPEN], { onCommand });
		await open();

		await act(async () => {
			rowAction(0, "Copy agent prompt")?.click();
		});
		expect(writeText).toHaveBeenCalledWith(
			"Address comment c1 in /notes/plan.md",
		);

		await act(async () => {
			rowAction(0, "Resolve")?.click();
		});
		expect(onCommand).toHaveBeenCalledWith("toggleResolved", "c1");

		await act(async () => {
			rowAction(1, "Delete comment")?.click();
		});
		expect(onCommand).toHaveBeenCalledWith("delete", "c2");
	});

	it("moves one tab stop into the grid and navigates it with arrows", async () => {
		render([OPEN, ALSO_OPEN]);
		await open();

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
});

function open() {
	return act(async () => {
		document.querySelector("button")?.click();
	});
}

function panelText() {
	return document.querySelector("[data-review-comment-summary]")?.textContent;
}

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

function rowAction(row: number, label: string) {
	return document.querySelector<HTMLButtonElement>(
		`[data-review-comment-summary] [data-row="${row}"][aria-label="${label}"]`,
	);
}

function findCopyButton() {
	return document.querySelector<HTMLButtonElement>(
		"[data-review-copy-all-prompt]",
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

function stubClipboard() {
	const writeText = vi.fn(async () => {});
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	return writeText;
}

function render(threads: ReviewThread[], props: Record<string, unknown> = {}) {
	const rootEl = document.createElement("div");
	document.body.append(rootEl);
	const root = createRoot(rootEl);
	roots.push(root);
	act(() => {
		root.render(
			createElement(ReviewCommentSummary, {
				filePath: "/notes/plan.md",
				threads,
				onCommand: () => {},
				...props,
			}),
		);
	});
}
