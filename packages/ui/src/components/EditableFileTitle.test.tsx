// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableFileTitle } from "./EditableFileTitle";

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

describe("EditableFileTitle", () => {
	it("shows the basename with its extension and selects it for rename", () => {
		renderTitle();
		expect(document.querySelector("button")?.textContent).toBe("note.md");
		const input = beginEdit();
		expect(input.value).toBe("note.md");
		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe("note.md".length);
	});

	it.each(["Enter", "blur"])("commits a trimmed rename on %s", (action) => {
		const onRename = vi.fn();
		renderTitle({ onRename });
		const input = beginEdit();
		change(input, "  renamed.md  ");
		act(() => {
			if (action === "blur") input.blur();
			else
				input.dispatchEvent(
					new KeyboardEvent("keydown", { key: action, bubbles: true }),
				);
		});
		expect(onRename).toHaveBeenCalledExactlyOnceWith("renamed.md");
		expect(document.querySelector("input")).toBeNull();
	});

	it.each([
		"",
		"   ",
		" note.md ",
	])("does not rename to an empty or unchanged name: %j", (draft) => {
		const onRename = vi.fn();
		renderTitle({ onRename });
		const input = beginEdit();
		change(input, draft);
		act(() => input.blur());
		expect(onRename).not.toHaveBeenCalled();
	});

	it("Escape discards changes without committing on blur", () => {
		const onRename = vi.fn();
		renderTitle({ onRename });
		const input = beginEdit();
		change(input, "renamed.md");
		act(() =>
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		act(() => input.blur());
		expect(onRename).not.toHaveBeenCalled();
		expect(document.querySelector("button")?.textContent).toBe("note.md");
	});

	it("a file key change discards the previous file's draft", () => {
		const onRename = vi.fn();
		const root = renderTitle({ onRename });
		change(beginEdit(), "unfinished.md");
		act(() =>
			root.render(
				<EditableFileTitle
					key="/workspace/other.md"
					currentPath="/workspace/other.md"
					onRename={onRename}
				/>,
			),
		);
		expect(document.querySelector("input")).toBeNull();
		expect(document.querySelector("button")?.textContent).toBe("other.md");
		expect(onRename).not.toHaveBeenCalled();
	});

	it.each([
		"/workspace/note.md",
		null,
	])("keeps noneditable titles disabled: %j", (currentPath) => {
		renderTitle({ currentPath, onRename: undefined });
		const button = document.querySelector("button");
		expect(button?.disabled).toBe(true);
		act(() => button?.click());
		expect(document.querySelector("input")).toBeNull();
	});
});

function renderTitle(
	props: {
		currentPath?: string | null;
		onRename?: (name: string) => void;
	} = {},
) {
	const { currentPath = "/workspace/note.md", onRename } = {
		onRename: vi.fn(),
		...props,
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<EditableFileTitle
				key={currentPath}
				currentPath={currentPath}
				onRename={onRename}
			/>,
		),
	);
	return root;
}

function beginEdit() {
	act(() => document.querySelector("button")?.click());
	const input = document.querySelector("input");
	if (!input) throw new Error("Missing title input");
	return input;
}

function change(input: HTMLInputElement, value: string) {
	act(() => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
