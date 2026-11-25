import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type ChatPayload, chatPayloadSchema } from "../src/desktopApi/chat";

export class ChatPayloadCache {
	private pending = Promise.resolve();
	constructor(private directory: string) {}

	save(id: string, payloads: ChatPayload[]) {
		if (!z.uuid().safeParse(id).success) return;
		const json = JSON.stringify(payloads);
		this.pending = this.pending
			.then(async () => {
				await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
				const filename = path.join(this.directory, `${id}.json`);
				await fs.writeFile(`${filename}.tmp`, json, { mode: 0o600 });
				await fs.rename(`${filename}.tmp`, filename);
				const files = (await fs.readdir(this.directory)).filter((name) =>
					name.endsWith(".json"),
				);
				if (files.length <= 50) return;
				const ages = await Promise.all(
					files.map(async (name) => ({
						name,
						time: (await fs.stat(path.join(this.directory, name))).mtimeMs,
					})),
				);
				ages.sort((a, b) => b.time - a.time);
				await Promise.all(
					ages
						.slice(50)
						.map(({ name }) => fs.rm(path.join(this.directory, name))),
				);
			})
			.catch((error) =>
				console.warn("Could not save API payload capture:", error),
			);
	}

	async read(id: string): Promise<ChatPayload[]> {
		if (!z.uuid().safeParse(id).success) return [];
		await this.flush();
		try {
			const json = await fs.readFile(
				path.join(this.directory, `${id}.json`),
				"utf8",
			);
			return z.array(chatPayloadSchema).max(32).parse(JSON.parse(json));
		} catch {
			return [];
		}
	}

	flush() {
		return this.pending;
	}
}
