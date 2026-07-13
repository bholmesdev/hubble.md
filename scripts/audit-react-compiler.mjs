import { spawnSync } from "node:child_process";

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
	throw new Error("Run this audit through `pnpm check:react-compiler`.");
}

const builds = [
	["--filter", "@hubble.md/ui", "run", "build"],
	["--filter", "@hubble.md/desktop", "run", "build"],
	["--filter", "@hubble.md/www", "run", "build"],
];

for (const args of builds) {
	// Build scripts run the React Compiler through each package's production Vite config.
	// Audit mode adds a compiler logger that catches diagnostics, including code the
	// React Compiler skips because it is incompatible.
	const result = spawnSync(process.execPath, [pnpmCli, ...args], {
		env: { ...process.env, REACT_COMPILER_AUDIT: "1" },
		stdio: "inherit",
	});

	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
