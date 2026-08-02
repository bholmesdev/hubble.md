import { describe, expect, it, vi } from "vitest";
import { dedupeRuns, keyedQueue, sequential, takeLatest } from "./concurrency";

describe("takeLatest", () => {
	it("marks earlier in-flight calls stale", async () => {
		const applied: string[] = [];
		const gates: Array<() => void> = [];
		const { run } = takeLatest(async ({ isStale }, value: string) => {
			await new Promise<void>((resolve) => {
				gates.push(resolve);
			});
			if (isStale()) return;
			applied.push(value);
		});

		const first = run("a");
		const second = run("b");
		for (const open of gates) open();
		await Promise.all([first, second]);

		expect(applied).toEqual(["b"]);
	});
});

describe("dedupeRuns", () => {
	it("coalesces calls made during a run into one follow-up run", async () => {
		const resolvers: Array<() => void> = [];
		const flush = dedupeRuns(
			() =>
				new Promise<void>((resolve) => {
					resolvers.push(resolve);
				}),
		);

		const first = flush();
		const second = flush();
		const third = flush();
		expect(resolvers).toHaveLength(1);

		resolvers[0]?.();
		await first;
		await vi.waitFor(() => expect(resolvers).toHaveLength(2));

		resolvers[1]?.();
		await Promise.all([second, third]);
		expect(resolvers).toHaveLength(2);
	});

	it("starts a fresh run after the previous one settles", async () => {
		let runs = 0;
		const flush = dedupeRuns(async () => {
			runs += 1;
		});
		await flush();
		await flush();
		expect(runs).toBe(2);
	});
});

describe("sequential", () => {
	it("runs calls in order and keeps going after a failure", async () => {
		const order: string[] = [];
		const write = sequential(async (value: string) => {
			order.push(value);
			if (value === "first") throw new Error("disk full");
		});

		const first = write("first");
		const second = write("second");

		await expect(first).rejects.toThrow("disk full");
		await second;
		expect(order).toEqual(["first", "second"]);
	});
});

describe("keyedQueue", () => {
	it("runs each key in order while other keys run", async () => {
		const queue = keyedQueue<string>();
		const order: string[] = [];
		let finishFirst: () => void = () => {};
		const first = queue.run(
			"a",
			() =>
				new Promise<void>((resolve) => {
					order.push("a1");
					finishFirst = resolve;
				}),
		);
		const second = queue.run("a", async () => {
			order.push("a2");
		});
		await queue.run("b", async () => {
			order.push("b");
		});

		expect(order).toEqual(["a1", "b"]);
		finishFirst();
		await Promise.all([first, second]);
		expect(order).toEqual(["a1", "b", "a2"]);
	});

	it("waits for matching work even when it fails", async () => {
		const queue = keyedQueue<string>();
		let finish: () => void = () => {};
		void queue.run(
			"note.md",
			() =>
				new Promise<void>((_resolve, reject) => {
					finish = () => reject(new Error("disk full"));
				}),
		);
		const waited = vi.fn();
		const wait = queue.waitFor((key) => key.endsWith(".md")).then(waited);

		expect(waited).not.toHaveBeenCalled();
		finish();
		await wait;
		expect(waited).toHaveBeenCalledOnce();
	});
});
