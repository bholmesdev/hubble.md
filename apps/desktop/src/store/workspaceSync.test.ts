import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let createWorkspaceSync: typeof import("./workspaceSync").createWorkspaceSync;

describe("createWorkspaceSync", () => {
	beforeEach(async () => {
		vi.stubGlobal("window", { desktopApi: {}, setTimeout, clearTimeout });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		({ createWorkspaceSync } = await import("./workspaceSync"));
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("coalesces a burst of hints into one scan", async () => {
		const scan = vi.fn(async () => {});
		const sync = createWorkspaceSync(scan);

		for (let index = 0; index < 20; index += 1) sync.markDirty();
		expect(scan).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300);
		expect(scan).toHaveBeenCalledTimes(1);
	});

	it("runs again for a hint that lands mid-scan", async () => {
		let release = () => {};
		const scan = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const sync = createWorkspaceSync(scan);

		sync.markDirty();
		await vi.advanceTimersByTimeAsync(300);
		expect(scan).toHaveBeenCalledTimes(1);

		// The crawl may already have walked past the folder this hint came from.
		sync.markDirty();
		release();
		await vi.advanceTimersByTimeAsync(300);
		expect(scan).toHaveBeenCalledTimes(2);
	});

	it("drops pending work on reset", async () => {
		const scan = vi.fn(async () => {});
		const sync = createWorkspaceSync(scan);

		sync.markDirty();
		sync.reset();
		await vi.advanceTimersByTimeAsync(1000);
		expect(scan).not.toHaveBeenCalled();
	});

	it("starts fresh while the previous workspace is still scanning", async () => {
		let releaseFirst = () => {};
		const scan = vi
			.fn<() => Promise<void>>()
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						releaseFirst = resolve;
					}),
			)
			.mockResolvedValue();
		const sync = createWorkspaceSync(scan);

		sync.markDirty();
		await vi.advanceTimersByTimeAsync(300);
		sync.reset();
		sync.markDirty();
		await vi.advanceTimersByTimeAsync(300);

		expect(scan).toHaveBeenCalledTimes(2);
		releaseFirst();
	});
});
