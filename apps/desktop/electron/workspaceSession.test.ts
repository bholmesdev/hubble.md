import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { expect, it, vi } from "vitest";
import { WorkspaceSession } from "./workspaceSession";

it("keeps the current workspace when an older start is cleaned up", () => {
	const handles: FSWatcher[] = [];
	const session = new WorkspaceSession(vi.fn(), () => {
		const watcher = Object.assign(new EventEmitter(), {
			close: vi.fn(),
		}) as unknown as FSWatcher;
		handles.push(watcher);
		return watcher;
	});
	const first = session.start("/workspace");
	const second = session.start("/workspace");
	session.stop(first);
	expect(session.root).toBe("/workspace");
	expect(handles[0].close).toHaveBeenCalledOnce();
	expect(handles[1].close).not.toHaveBeenCalled();
	session.stop(second);
	expect(session.root).toBeUndefined();
	expect(handles[1].close).toHaveBeenCalledOnce();
});

it("keeps tool scope when native watching cannot start or later fails", () => {
	const changes = vi.fn();
	const unavailable = new WorkspaceSession(changes, () => {
		throw Error("Native watching unavailable");
	});
	const generation = unavailable.start("/workspace");
	expect(unavailable.root).toBe("/workspace");
	unavailable.stop(generation);
	expect(unavailable.root).toBeUndefined();
	const watcher = Object.assign(new EventEmitter(), {
		close: vi.fn(),
	}) as unknown as FSWatcher;
	const session = new WorkspaceSession(changes, () => watcher);
	const active = session.start("/workspace");
	watcher.emit("error", Error("Watch failed"));
	expect(session.root).toBe("/workspace");
	expect(changes).toHaveBeenCalledWith({ kind: "refresh" });
	session.stop(active);
	expect(session.root).toBeUndefined();
});
