import { execFileSync } from "node:child_process";

// Native layout detection runs only on macOS. Other platforms need no new build tools.
if (process.platform === "darwin") {
	execFileSync(
		"pnpm",
		[
			"--filter",
			"@hubble.md/desktop",
			"exec",
			"electron-builder",
			"install-app-deps",
		],
		{ stdio: "inherit" },
	);
}
