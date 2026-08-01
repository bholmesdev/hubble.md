import type fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPathCoalescer,
	normalizeEventPath,
	type WatchListener,
	watchWorkspace,
} from "./workspaceWatcher";

function fakeWatcher() {
	let listener: WatchListener | undefined;
	let errorListener: (() => void) | undefined;
	const watcher = {
		close: vi.fn(),
		on: vi.fn((event: string, callback: () => void) => {
			if (event === "error") errorListener = callback;
			return watcher;
		}),
		emit(eventType: string, filename: string | null) {
			listener?.(eventType, filename);
		},
		emitError() {
			errorListener?.();
		},
		setListener(next: WatchListener) {
			listener = next;
		},
	};
	return watcher as typeof watcher & fs.FSWatcher;
}

describe("workspace watcher", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("normalizes only paths inside the watched root", () => {
		expect(normalizeEventPath("/workspace", "notes/today.md")).toBe(
			"/workspace/notes/today.md",
		);
		expect(normalizeEventPath("/workspace", "../outside.md")).toBe(null);
		expect(normalizeEventPath("/workspace", null)).toBe(null);
	});

	it("coalesces duplicate paths into one short batch", () => {
		const onPaths = vi.fn();
		const coalescer = createPathCoalescer(onPaths, 50);

		coalescer.add("/workspace/note.md");
		coalescer.add("/workspace/note.md");
		coalescer.add("/workspace/other.md");
		vi.advanceTimersByTime(49);
		expect(onPaths).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onPaths).toHaveBeenCalledWith([
			"/workspace/note.md",
			"/workspace/other.md",
		]);
	});

	it("ignores content changes and reports rename events", () => {
		const watcher = fakeWatcher();
		const onPaths = vi.fn();
		const onFallback = vi.fn();
		const handle = watchWorkspace(
			"/workspace",
			onPaths,
			onFallback,
			(_root, listener) => {
				watcher.setListener(listener);
				return watcher;
			},
		);

		watcher.emit("change", "note.md");
		vi.runAllTimers();
		expect(onPaths).not.toHaveBeenCalled();

		watcher.emit("rename", "note.md");
		vi.runAllTimers();
		expect(onPaths).toHaveBeenCalledWith(["/workspace/note.md"]);
		expect(onFallback).not.toHaveBeenCalled();

		handle?.close();
		watcher.emit("rename", "later.md");
		vi.runAllTimers();
		expect(onPaths).toHaveBeenCalledTimes(1);
	});

	it("falls back when the native watcher reports an error", () => {
		const watcher = fakeWatcher();
		const onFallback = vi.fn();
		watchWorkspace("/workspace", vi.fn(), onFallback, (_root, listener) => {
			watcher.setListener(listener);
			return watcher;
		});

		watcher.emitError();
		expect(onFallback).toHaveBeenCalledOnce();
		expect(watcher.close).toHaveBeenCalledOnce();
	});

	it("falls back when a rename event has no usable path", () => {
		const watcher = fakeWatcher();
		const onFallback = vi.fn();
		watchWorkspace("/workspace", vi.fn(), onFallback, (_root, listener) => {
			watcher.setListener(listener);
			return watcher;
		});

		watcher.emit("rename", null);

		expect(onFallback).toHaveBeenCalledOnce();
	});

	it("does not install a watcher when recursive watch is unsupported", () => {
		const onFallback = vi.fn();
		const handle = watchWorkspace("/workspace", vi.fn(), onFallback, () => {
			throw new Error("recursive watch unavailable");
		});

		expect(handle).toBe(null);
		expect(onFallback).not.toHaveBeenCalled();
	});
});
