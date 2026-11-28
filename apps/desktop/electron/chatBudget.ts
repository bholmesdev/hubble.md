import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);
// JSON tokenization is a local estimate; leave room for server-side framing.
const budget = 200_000 - 4_096;
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
	number,
	{ resolve: (fits: boolean) => void; reject: (error: Error) => void }
>();

// BPE can take seconds on large notes. Keep it off both Electron's main thread and the renderer.
export function withinChatTokenBudget(input: unknown): Promise<boolean> {
	if (!worker) {
		worker = new Worker(
			`
    const {parentPort, workerData} = require("node:worker_threads");
    const {isWithinTokenLimit} = require(workerData.tokenizer);
    parentPort.on("message", ({id, text}) => {
      try {
        parentPort.postMessage({id, fits: isWithinTokenLimit(text, workerData.budget, {disallowedSpecial: new Set()}) !== false});
      } catch (error) { parentPort.postMessage({id, error: error.message}); }
    });
  `,
			{
				eval: true,
				workerData: {
					tokenizer: require.resolve("gpt-tokenizer/encoding/o200k_base"),
					budget,
				},
			},
		);
		const current = worker;
		current.on("message", ({ id, fits, error }) => {
			const task = pending.get(id);
			pending.delete(id);
			if (error) task?.reject(new Error(error));
			else task?.resolve(fits);
			if (!pending.size) current.unref();
		});
		const failed = (error: Error) => {
			if (worker !== current) return;
			worker = undefined;
			for (const task of pending.values()) task.reject(error);
			pending.clear();
		};
		current.on("error", failed);
		current.on("exit", () =>
			failed(new Error("Could not count Chat context. Try sending again.")),
		);
	}
	const id = ++sequence;
	const text = JSON.stringify(input);
	const current = worker;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		current.ref();
		current.postMessage({ id, text });
	});
}
