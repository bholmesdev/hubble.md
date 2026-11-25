import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { VoiceEvent } from "../src/desktopApi/voice";
import { createRangeTranscript, createTranscript } from "./speechTranscript";

const output = z.object({
	status: z.enum(["starting", "listening", "stopping", "stopped", "error"]),
	level: z.number().finite().min(0).max(1).optional(),
	text: z.string().max(100_000).optional(),
	error: z.string().max(2000).optional(),
	range: z
		.object({
			start: z.number().finite().nonnegative(),
			end: z.number().finite().positive(),
		})
		.refine((range) => range.end > range.start)
		.optional(),
	settled: z.boolean().optional(),
	session: z.number().int().min(0).max(1000).optional(),
	segments: z
		.array(
			z.object({
				start: z.number().nonnegative().finite(),
				end: z.number().nonnegative().finite(),
				text: z.string().max(10000),
			}),
		)
		.max(2000)
		.optional(),
});

export function launchDictation(
	bundle: string,
	send: (event: Omit<VoiceEvent, "id">) => void,
) {
	const ranges = createRangeTranscript();
	const sessions = new Map<number, ReturnType<typeof createTranscript>>();
	let text = "";
	let socket: Socket | undefined;
	let stopped = false;
	let closed = false;
	let ended = false;
	let listening = false;
	let directory: string | undefined;
	let timer: ReturnType<typeof setTimeout>;
	let launcher: ReturnType<typeof spawn> | undefined;
	const server = createServer((client) => {
		if (closed || socket) {
			client.destroy();
			return;
		}
		socket = client;
		server.close();
		if (stopped) client.write("stop\n");
		const lines = createInterface({ input: client });
		lines.on("line", (line) => {
			try {
				const event = output.parse(JSON.parse(line));
				if (event.status === "listening" && !listening && !stopped) {
					listening = true;
					clearTimeout(timer);
					timer = setTimeout(finish, 195_000);
				}
				if (event.status === "stopped" || event.status === "error")
					ended = true;
				const {
					segments,
					session = 0,
					settled = false,
					range,
					...result
				} = event;
				if (range && result.text !== undefined)
					result.text = ranges.update(range, result.text);
				else if (segments) {
					// A prior session can finish after the next one has started speaking.
					if (!sessions.has(session)) sessions.set(session, createTranscript());
					sessions.get(session)?.update(segments, settled);
					result.text = [...sessions]
						.sort(([a], [b]) => a - b)
						.map(([, transcript]) => transcript.update([]))
						.filter(Boolean)
						.join(" ");
				}
				if (result.text !== undefined) text = result.text;
				if (ended) result.text = text;
				send(result);
			} catch {
				finish();
			}
		});
		client.on("error", () => finish());
		client.on("close", () => finish());
	});
	const clean = () => {
		clearTimeout(timer);
		socket?.destroy();
		server.close();
		launcher?.kill();
		if (directory) void rm(directory, { recursive: true, force: true });
	};
	const finish = () => {
		if (closed) return;
		closed = true;
		clean();
		if (!ended)
			send({
				status: "error",
				error:
					"Dictation stopped unexpectedly. Any recognized text remains in your draft. Try recording again.",
			});
	};
	server.on("error", finish);
	const ready = (async () => {
		// Unix socket paths are short, and mkdtemp keeps each recording private to this user.
		directory = await mkdtemp("/tmp/hubble-voice-");
		if (closed) {
			clean();
			return;
		}
		const address = path.join(directory, "speech.sock");
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(address, () => {
				server.off("error", reject);
				resolve();
			});
		});
		if (closed) {
			clean();
			return;
		}
		// Launch Services gives dictation its own privacy identity instead of inheriting the terminal's.
		launcher = spawn(
			"/usr/bin/open",
			["-n", "-g", "-W", bundle, "--args", address],
			{ stdio: "ignore" },
		);
		launcher.on("error", finish);
		launcher.on("close", () => {
			if (!socket) finish();
		});
		// Model setup must not consume the three-minute recording allowance.
		if (!stopped && !listening) timer = setTimeout(finish, 600_000);
	})().catch(finish);
	return {
		ready,
		stop() {
			if (closed || stopped) return;
			stopped = true;
			socket?.write("stop\n");
			clearTimeout(timer);
			timer = setTimeout(finish, 12000);
		},
		cancel() {
			ended = true;
			finish();
		},
	};
}
