// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { revealAttachment } from "./attachments";
import { watchSelection } from "./autoAttach";

afterEach(() => vi.useRealTimers());
it("waits for a settled selection, avoids repeats, and cancels pending attachments on cleanup", () => {
	vi.useFakeTimers();
	const element = document.createElement("div");
	document.body.append(element);
	const editor = new Editor({
		element,
		extensions: [StarterKit],
		content: "<p>Alpha beta gamma</p>",
	});
	editor.view.dom.focus();
	const attach = vi.fn(() => true);
	const stop = watchSelection(editor, "/notes/a.md", attach);
	editor.commands.setTextSelection({ from: 1, to: 6 });
	vi.advanceTimersByTime(600);
	editor.commands.setTextSelection({ from: 1, to: 11 });
	vi.advanceTimersByTime(699);
	expect(attach).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(attach).toHaveBeenCalledExactlyOnceWith({
		kind: "selection",
		path: "/notes/a.md",
		text: "Alpha beta",
		source: { from: 1, to: 11, text: "Alpha beta" },
	});
	expect(editor.view.dom.classList.contains("hubble-selection-attached")).toBe(
		true,
	);
	editor.emit("selectionUpdate", { editor, transaction: editor.state.tr });
	vi.advanceTimersByTime(700);
	expect(attach).toHaveBeenCalledTimes(1);
	editor.commands.setTextSelection({ from: 7, to: 11 });
	stop();
	vi.advanceTimersByTime(700);
	expect(attach).toHaveBeenCalledTimes(1);
	editor.destroy();
	element.remove();
});
it("does not capture while dragging or flash rejected attachments", () => {
	vi.useFakeTimers();
	const editor = new Editor({
		extensions: [StarterKit],
		content: "<p>Alpha beta</p>",
	});
	document.body.append(editor.view.dom);
	editor.view.dom.focus();
	const attach = vi.fn(() => false);
	const stop = watchSelection(editor, "/notes/a.md", attach);
	editor.view.dom.dispatchEvent(new Event("pointerdown"));
	editor.commands.setTextSelection({ from: 1, to: 6 });
	vi.advanceTimersByTime(1000);
	expect(attach).not.toHaveBeenCalled();
	window.dispatchEvent(new Event("pointerup"));
	vi.advanceTimersByTime(700);
	expect(attach).toHaveBeenCalledTimes(1);
	expect(editor.view.dom.classList.contains("hubble-selection-attached")).toBe(
		false,
	);
	stop();
	editor.destroy();
});

it("does not auto-attach a selection revealed from a transcript pill", () => {
	vi.useFakeTimers();
	const editor = new Editor({
		extensions: [StarterKit],
		content: "<p>Alpha beta gamma</p>",
	});
	document.body.append(editor.view.dom);
	editor.view.dom.focus();
	const attach = vi.fn(() => true);
	const stop = watchSelection(editor, "/notes/a.md", attach);
	editor.commands.setTextSelection({ from: 1, to: 6 });
	vi.advanceTimersByTime(700);
	expect(attach).toHaveBeenCalledTimes(1);
	editor.commands.setTextSelection({ from: 7, to: 11 });
	vi.advanceTimersByTime(700);
	expect(attach).toHaveBeenCalledTimes(2);
	revealAttachment(editor, {
		kind: "selection",
		path: "/notes/a.md",
		text: "Alpha",
		source: { from: 1, to: 6, text: "Alpha" },
	});
	vi.advanceTimersByTime(1000);
	expect(attach).toHaveBeenCalledTimes(2);
	stop();
	editor.destroy();
});
