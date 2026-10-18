import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e-web",
	testMatch: "*.e2e.ts",
	timeout: 30_000,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	use: {
		channel: process.env.PLAYWRIGHT_CHANNEL,
		baseURL: "http://127.0.0.1:5177",
		trace: "retain-on-failure",
	},
	outputDir: "test-results-web",
	webServer: {
		command:
			"pnpm --filter @hubble.md/www... --if-present build && pnpm --filter @hubble.md/www preview --host 127.0.0.1 --port 5177 --strictPort",
		url: "http://127.0.0.1:5177",
		timeout: 120_000,
	},
});
