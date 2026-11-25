import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { ChatPayload } from "../src/desktopApi/chat";
import { ChatPayloadCache } from "./chatPayloadCache";

it("restores captured requests and responses after a new cache instance and rejects paths outside the cache", async () => {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "hubble-payloads-"),
	);
	try {
		const id = crypto.randomUUID();
		const cache = new ChatPayloadCache(directory);
		const packets: ChatPayload[] = [
			{
				round: 1,
				direction: "request",
				body: {
					model: "test",
					input: [{ role: "user", content: "A quote and transcript" }],
				},
			},
			{
				round: 1,
				direction: "response",
				body: { id: "response", output: [], usage: { input_tokens: 10 } },
			},
		];
		cache.save(id, packets.slice(0, 1));
		cache.save(id, packets);
		await cache.flush();
		expect(await new ChatPayloadCache(directory).read(id)).toEqual(packets);
		expect(await cache.read("../connection.enc")).toEqual([]);
		expect(await cache.read(crypto.randomUUID())).toEqual([]);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
