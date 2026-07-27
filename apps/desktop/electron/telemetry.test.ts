import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetryManager, telemetryEventNames } from "./telemetry";

const dirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true })),
	);
});

async function setup(
	overrides: Partial<ConstructorParameters<typeof TelemetryManager>[0]> = {},
) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-telemetry-"));
	dirs.push(dir);
	const send = vi.fn(
		async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(null, { status: 202 }),
	);
	const manager = new TelemetryManager({
		statePath: path.join(dir, "telemetry.json"),
		endpoint: "https://example.test/telemetry",
		domain: "hubble.md",
		canSend: true,
		version: "1.2.3",
		userAgent: () => "Mozilla/5.0 Hubble/1.2.3",
		fetch: send,
		now: () => new Date(2026, 6, 19, 23, 30),
		installationId: () => "123e4567-e89b-42d3-a456-426614174000",
		platform: "darwin",
		arch: "arm64",
		...overrides,
	});
	await manager.load();
	return { manager, send, statePath: path.join(dir, "telemetry.json") };
}

describe("TelemetryManager", () => {
	it("does not send in builds where sending is disabled", async () => {
		const { manager, send } = await setup({ canSend: false });
		await manager.recordActivity(false);
		await manager.setConsent("enabled");
		await manager.recordActivity(false);
		await manager.flush();
		expect(send).not.toHaveBeenCalled();
	});

	it("collects before the notice is acknowledged (opt-out)", async () => {
		const { manager, send } = await setup();
		await manager.recordActivity(false);
		await manager.flush();
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("does not send after opting out", async () => {
		const { manager, send } = await setup();
		await manager.setConsent("declined");
		await manager.recordActivity(false);
		await manager.flush();
		expect(send).not.toHaveBeenCalled();
	});

	it("sends each daily event once and only upgrades HTML use", async () => {
		const { manager, send } = await setup();
		await manager.recordActivity(false);
		await manager.setConsent("enabled");
		await manager.flush();
		await manager.recordActivity(false);
		await manager.flush();
		await manager.recordActivity(true);
		await manager.flush();
		await manager.recordActivity(false);
		await manager.flush();

		expect(send).toHaveBeenCalledTimes(2);
		const activity = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
		const htmlApp = JSON.parse(String(send.mock.calls[1]?.[1]?.body));
		expect(activity).toMatchObject({
			domain: "hubble.md",
			name: "Desktop Active",
			url: "https://hubble.md/telemetry/desktop",
			interactive: false,
			props: {
				installationId: "123e4567-e89b-42d3-a456-426614174000",
				localDate: "2026-07-19",
				version: "1.2.3",
				os: "darwin",
				arch: "arm64",
			},
		});
		expect(htmlApp.name).toBe("HTML App Used");
	});

	it("retries failures and deletes identity when disabled", async () => {
		const { manager, send, statePath } = await setup();
		send.mockResolvedValueOnce(new Response(null, { status: 500 }));
		await manager.setConsent("enabled");
		await manager.recordActivity(false);
		await manager.flush();
		expect(send).toHaveBeenCalledTimes(2);

		await manager.setConsent("declined");
		const persisted = JSON.parse(await fs.readFile(statePath, "utf8"));
		expect(persisted).toEqual({ consent: "declined", days: {} });
	});

	it("aborts an in-flight request when disabled", async () => {
		let requestSignal: AbortSignal | null = null;
		const send = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					requestSignal = init?.signal as AbortSignal;
					requestSignal.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				}),
		);
		const { manager } = await setup({ fetch: send });
		await manager.setConsent("enabled");
		const record = manager.recordActivity(false);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		await manager.setConsent("declined");
		await record;

		expect(requestSignal?.aborted).toBe(true);
	});

	it("does not create state or an installation id before any activity", async () => {
		const { statePath } = await setup();
		await expect(fs.readFile(statePath, "utf8")).rejects.toThrow();
	});

	it("prunes delivered days once the day has passed", async () => {
		let current = new Date(2026, 6, 19, 23, 30);
		const { manager, statePath } = await setup({ now: () => current });
		await manager.setConsent("enabled");
		await manager.recordActivity(false);

		current = new Date(2026, 6, 20, 8, 0);
		await manager.recordActivity(false);

		const persisted = JSON.parse(await fs.readFile(statePath, "utf8"));
		expect(Object.keys(persisted.days)).toEqual(["2026-07-20"]);
	});

	it("drops undelivered days past the retention window", async () => {
		let current = new Date(2026, 6, 19, 23, 30);
		const { manager, send, statePath } = await setup({
			canSend: false,
			now: () => current,
		});
		await manager.setConsent("enabled");
		await manager.recordActivity(false);

		current = new Date(2026, 8, 1, 8, 0);
		await manager.recordActivity(false);

		expect(send).not.toHaveBeenCalled();
		const persisted = JSON.parse(await fs.readFile(statePath, "utf8"));
		expect(Object.keys(persisted.days)).toEqual(["2026-09-01"]);
	});

	it("documents every event in TELEMETRY.md", async () => {
		const doc = await fs.readFile(
			fileURLToPath(new URL("../../../TELEMETRY.md", import.meta.url)),
			"utf8",
		);
		for (const name of Object.values(telemetryEventNames)) {
			expect(doc).toContain(`\`${name}\``);
		}
	});

	it("fails closed on malformed state", async () => {
		const { statePath } = await setup();
		await fs.writeFile(statePath, '{"consent":"enabled","days":"bad"}');
		const send = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(null, { status: 202 }),
		);
		const manager = new TelemetryManager({
			statePath,
			endpoint: "https://example.test",
			domain: "hubble.md",
			canSend: true,
			version: "1",
			userAgent: () => "Mozilla/5.0",
			fetch: send,
		});
		await manager.load();
		expect(manager.getConsent()).toBe("unset");
		await manager.flush();
		expect(send).not.toHaveBeenCalled();
	});
});
