import { describe, expect, it, vi } from "vitest";
import { dedupeRuns, sequential, takeLatest } from "./concurrency";

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
