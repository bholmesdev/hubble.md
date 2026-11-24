import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
	new URL("../../../scripts/require-tldraw-license.mjs", import.meta.url),
);

describe("desktop release license check", () => {
	it.each([
		undefined,
		"",
		" \n\t",
	])("rejects a missing or blank key (%j)", (key) => {
		const env = { ...process.env };
		delete env.VITE_TLDRAW_LICENSE_KEY;
		if (key !== undefined) env.VITE_TLDRAW_LICENSE_KEY = key;
		const result = spawnSync(process.execPath, [script], {
			env,
			encoding: "utf8",
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("TLDRAW_LICENSE_KEY is required");
	});

	it("accepts a configured key without printing it", () => {
		const result = spawnSync(process.execPath, [script], {
			env: { ...process.env, VITE_TLDRAW_LICENSE_KEY: "test-key" },
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).toBe("");
	});
});
