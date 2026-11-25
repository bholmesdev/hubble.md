import { store } from "@simplestack/store";
import { desktopApi } from "../desktopApi";
import type { ChatPayload } from "../desktopApi/chat";

export const chatDebug = store(false);
export const chatPayloads = store<Record<string, ChatPayload[]>>({});

const loading = new Map<string, Promise<void>>();

export function loadChatPayloads(id: string) {
	const pending = loading.get(id);
	if (pending) return pending;
	const task = (async () => {
		try {
			const saved = await desktopApi.chatPayloads(id);
			if (saved.length)
				chatPayloads.set((current) =>
					keepRecent(current, id, merge(saved, current[id] ?? [])),
				);
		} catch {
			/* Saved message data remains available when no capture can be read. */
		}
	})().finally(() => loading.delete(id));
	loading.set(id, task);
	return task;
}

export function recordChatPayload(id: string, payload: ChatPayload) {
	chatPayloads.set((current) =>
		keepRecent(current, id, merge(current[id] ?? [], [payload])),
	);
}

function merge(before: ChatPayload[], after: ChatPayload[]) {
	const packets = new Map(
		[...before, ...after].map((item) => [
			`${item.round}:${item.direction}`,
			item,
		]),
	);
	const order = { request: 0, response: 1, error: 2 };
	return [...packets.values()].sort(
		(a, b) => a.round - b.round || order[a.direction] - order[b.direction],
	);
}

function keepRecent(
	current: Record<string, ChatPayload[]>,
	id: string,
	packets: ChatPayload[],
) {
	const next = { ...current, [id]: packets };
	// Requests repeat prior context, so bound the in-memory copy to 50 turns.
	if (Object.keys(next).length > 50) delete next[Object.keys(next)[0]];
	return next;
}
