#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import {
	createConvexBackend,
	createConvexSubscriber,
} from "@hubble.md/convex-client";
import {
	type CloudSyncConfig,
	readConfigOrDefault,
	removeCloudSyncConfig,
	sync as runSync,
	type SyncResult,
	writeCloudSyncConfig,
	writeSyncState,
} from "@hubble.md/sync";
import { createNodeFileSystem } from "@hubble.md/sync/node";
import chokidar from "chokidar";

const fs = createNodeFileSystem();

function getConvexUrl(): string {
	return process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
}

type CliArgs = {
	command?: string;
	help: boolean;
	workspaceName?: string;
	workspaceId?: string;
	deploymentUrl?: string;
	extraArgs: string[];
	workspacePath: string;
};

async function main() {
	const parsed = parseCliArgs(process.argv.slice(2));
	if ("error" in parsed) {
		console.error(parsed.error);
		printUsage();
		process.exitCode = 1;
		return;
	}

	if (parsed.help) {
		printHelp(parsed);
		return;
	}

	if (parsed.command === "cloud") {
		await runCloudCommand(parsed);
		return;
	}

	printUsage();
	process.exitCode = 1;
}

async function runCloudCommand(parsed: CliArgs) {
	const [action, ...extraArgs] = parsed.extraArgs;
	const { workspacePath } = parsed;

	if (extraArgs.length > 0) {
		printUsage();
		process.exitCode = 1;
		return;
	}

	switch (action) {
		case "create":
			await runCreate(workspacePath, parsed);
			return;
		case "connect":
			await runConnect(workspacePath, parsed);
			return;
		case "disconnect":
			await removeCloudSyncConfig(fs, workspacePath);
			console.log("Cloud Sync disconnected");
			return;
		case "sync":
			await runManualSync(workspacePath);
			return;
		case "watch":
			await runWatch(workspacePath);
			return;
	}

	printUsage();
	process.exitCode = 1;
}

async function runManualSync(workspacePath: string) {
	const cloudSync = await readCloudSyncConfig(workspacePath);
	if (!cloudSync) return;

	await syncOnce(workspacePath, cloudSync, "manual");
}

async function runWatch(workspacePath: string) {
	const cloudSync = await readCloudSyncConfig(workspacePath);
	if (!cloudSync) return;

	await syncContinuously(workspacePath, cloudSync);
}

async function runCreate(workspacePath: string, opts: CliArgs) {
	if (opts.workspaceId) {
		console.error("Use --name with create, not --id.");
		process.exitCode = 1;
		return;
	}
	if (!opts.workspaceName) {
		console.error("Missing required --name.");
		process.exitCode = 1;
		return;
	}

	const deploymentUrl = getDeploymentUrl(opts);
	const backend = createConvexBackend(deploymentUrl);
	const workspaceId = await backend.createWorkspace(opts.workspaceName);
	await writeCloudConnection(workspacePath, {
		deploymentUrl,
		workspaceId,
		label: opts.workspaceName,
	});
}

async function runConnect(workspacePath: string, opts: CliArgs) {
	if (opts.workspaceName && opts.workspaceId) {
		console.error("Use only one of --name or --id.");
		process.exitCode = 1;
		return;
	}
	if (!opts.workspaceName && !opts.workspaceId) {
		console.error("Missing required --name or --id.");
		process.exitCode = 1;
		return;
	}

	const deploymentUrl = getDeploymentUrl(opts);
	const backend = createConvexBackend(deploymentUrl);
	const workspaceId =
		opts.workspaceId ?? (await backend.getWorkspace(opts.workspaceName ?? ""));

	if (!workspaceId) {
		console.error(`Remote workspace not found: ${opts.workspaceName}`);
		process.exitCode = 1;
		return;
	}

	await writeCloudConnection(workspacePath, {
		deploymentUrl,
		workspaceId,
		label: opts.workspaceName ?? workspaceId,
	});
}

async function writeCloudConnection(
	workspacePath: string,
	opts: {
		deploymentUrl: string;
		workspaceId: string;
		label: string;
	},
) {
	const current = await readConfigOrDefault(fs, workspacePath);
	const deviceId = current.cloudSync?.deviceId ?? crypto.randomUUID();
	const config = await writeCloudSyncConfig(fs, workspacePath, {
		provider: "convex",
		deploymentUrl: opts.deploymentUrl,
		workspaceId: opts.workspaceId,
		deviceId,
		backgroundSync: current.cloudSync?.backgroundSync ?? false,
	});
	await ensureSyncState(workspacePath);
	console.log(`Cloud Sync connected: ${opts.label}`);
	console.log(`  workspace: ${config.cloudSync?.workspaceId}`);
	console.log(`  device: ${config.cloudSync?.deviceId}`);
}

function getDeploymentUrl(opts: Pick<CliArgs, "deploymentUrl">): string {
	return opts.deploymentUrl ?? getConvexUrl();
}

async function syncOnce(
	workspacePath: string,
	cloudSync: CloudSyncConfig,
	reason: string,
) {
	const backend = createConvexBackend(cloudSync.deploymentUrl);
	const result = await runSync(backend, fs, workspacePath);
	logResult(reason, result);
	return result;
}

async function syncContinuously(
	workspacePath: string,
	cloudSync: CloudSyncConfig,
) {
	const convexUrl = cloudSync.deploymentUrl;
	console.log(`Hubble Sync watching ${workspacePath}`);
	console.log(`Workspace: ${cloudSync.workspaceId}`);

	const scheduler = createSyncScheduler(workspacePath, cloudSync);
	await scheduler.enqueue("startup");

	const subscriber = createConvexSubscriber(convexUrl);
	const unsubscribe = subscriber.onFilesChanged(
		cloudSync.workspaceId,
		() => {
			void scheduler.enqueue("remote");
		},
		(err) => {
			console.error("Remote subscription failed:", err);
		},
	);

	let fsEventCount = 0;
	let fsTimer: ReturnType<typeof setTimeout> | null = null;
	const watcher = chokidar.watch(workspacePath, {
		ignoreInitial: true,
		ignored: (path) =>
			path.includes("/.hubble/") ||
			path.endsWith("/.hubble") ||
			path.includes("\\.hubble\\"),
	});

	const handleFsEvent = (event: string, path: string) => {
		fsEventCount += 1;
		console.log(`fs ${event}: ${path}`);
		if (fsTimer) clearTimeout(fsTimer);
		fsTimer = setTimeout(() => {
			const count = fsEventCount;
			fsEventCount = 0;
			void scheduler.enqueue(
				`filesystem (${count} event${count === 1 ? "" : "s"})`,
			);
		}, 250);
	};

	watcher
		.on("add", (path) => handleFsEvent("add", path))
		.on("change", (path) => handleFsEvent("change", path))
		.on("unlink", (path) => handleFsEvent("unlink", path))
		.on("addDir", (path) => handleFsEvent("addDir", path))
		.on("unlinkDir", (path) => handleFsEvent("unlinkDir", path))
		.on("error", (err) => {
			console.error("Workspace watcher failed:", err);
		});

	const shutdown = async (signal: string) => {
		console.log(`Stopping Hubble Sync (${signal})`);
		if (fsTimer) clearTimeout(fsTimer);
		unsubscribe();
		await subscriber.close();
		await watcher.close();
		process.exit(0);
	};

	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});
	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
}

function createSyncScheduler(
	workspacePath: string,
	cloudSync: CloudSyncConfig,
) {
	let running = false;
	let pending = false;
	let pendingReason = "queued";

	const run = async (reason: string) => {
		if (running) {
			pending = true;
			pendingReason = reason;
			return;
		}

		running = true;
		let currentReason = reason;
		try {
			while (true) {
				await syncOnce(workspacePath, cloudSync, currentReason);
				if (!pending) break;
				pending = false;
				currentReason = pendingReason;
			}
		} catch (error) {
			console.error("Cloud Sync failed:", error);
		} finally {
			running = false;
		}
	};

	return {
		enqueue: run,
	};
}

async function readCloudSyncConfig(
	workspacePath: string,
): Promise<CloudSyncConfig | null> {
	const config = await readConfigOrDefault(fs, workspacePath);
	if (config.cloudSync) return config.cloudSync;
	console.error(
		`No Cloud Sync config in ${workspacePath}. Run \`hubble cloud connect\` first.`,
	);
	process.exitCode = 1;
	return null;
}

async function ensureSyncState(workspacePath: string) {
	const state = await fs.readFileOrNull(`${workspacePath}/.hubble/state.json`);
	if (!state) {
		await writeSyncState(fs, workspacePath, { lastSyncedAt: 0, files: {} });
	}
}

function logResult(reason: string, result: SyncResult) {
	const files = `files(+${result.pushed.length} -${result.deleted.length} ↓${result.pulled.length})`;
	const assets = `assets(+${result.assetsPushed} -${result.assetsDeleted} ↓${result.assetsPulled} failed:${result.assetsFailed.length})`;
	console.log(`sync ${reason}: ${files} ${assets}`);
	if (result.conflicts.length > 0) {
		console.log(`  conflicts: ${result.conflicts.join(", ")}`);
	}
	if (result.assetsFailed.length > 0) {
		console.log(`  asset failures: ${result.assetsFailed.join(", ")}`);
	}
}

function parseCliArgs(argv: string[]) {
	try {
		const args = argv[0] === "--" ? argv.slice(1) : argv;
		const help = args.includes("--help") || args.includes("-h");
		const parseableArgs = help
			? args.filter((arg) => arg !== "--help" && arg !== "-h")
			: args;
		const { values, positionals } = parseNodeArgs({
			args: parseableArgs,
			allowPositionals: true,
			options: {
				cwd: { type: "string" },
				name: { type: "string" },
				id: { type: "string" },
				url: { type: "string" },
			},
		});
		const [command, ...extraArgs] = positionals;
		return {
			command,
			help,
			workspaceName: values.name,
			workspaceId: values.id,
			deploymentUrl: values.url,
			extraArgs,
			workspacePath: values.cwd ? resolve(values.cwd) : process.cwd(),
		} as const;
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : String(error),
		} as const;
	}
}

function printHelp(args: CliArgs) {
	if (args.command !== "cloud") {
		printRootHelp();
		return;
	}

	const [action] = args.extraArgs;
	switch (action) {
		case undefined:
			printCloudHelp();
			return;
		case "create":
			printCreateHelp();
			return;
		case "connect":
			printConnectHelp();
			return;
		case "sync":
			printSyncHelp();
			return;
		case "watch":
			printWatchHelp();
			return;
		case "disconnect":
			printDisconnectHelp();
			return;
		default:
			printCloudHelp();
	}
}

function printRootHelp() {
	console.log("Usage:");
	console.log("  hubble [--cwd path] cloud <command>");
	console.log("");
	console.log("Commands:");
	console.log("  cloud    Manage Cloud Sync");
}

function printCloudHelp() {
	console.log("Usage:");
	console.log("  hubble [--cwd path] cloud <command>");
	console.log("");
	console.log("Commands:");
	console.log("  create      Create and link a remote workspace");
	console.log("  connect     Link an existing remote workspace");
	console.log("  sync        Run one sync");
	console.log("  watch       Sync continuously");
	console.log("  disconnect  Remove Cloud Sync config");
}

function printCreateHelp() {
	console.log("Usage:");
	console.log("  hubble [--cwd path] cloud create --name name [--url url]");
	console.log("");
	console.log("Options:");
	console.log("  --name name  Remote workspace name to create");
	console.log("  --url url    Convex deployment URL");
}

function printConnectHelp() {
	console.log("Usage:");
	console.log(
		"  hubble [--cwd path] cloud connect (--name name|--id id) [--url url]",
	);
	console.log("");
	console.log("Options:");
	console.log("  --name name  Existing remote workspace name");
	console.log("  --id id      Existing remote workspace id");
	console.log("  --url url    Convex deployment URL");
}

function printSyncHelp() {
	console.log("Usage:");
	console.log("  hubble [--cwd path] cloud sync");
	console.log("");
	console.log("Runs one manual sync for a linked workspace.");
}

function printWatchHelp() {
	console.log("Usage:");
	console.log("  hubble [--cwd path] cloud watch");
	console.log("");
	console.log("Watches local and remote changes for a linked workspace.");
}

function printDisconnectHelp() {
	console.log("Usage:");
	console.log("  hubble [--cwd path] cloud disconnect");
	console.log("");
	console.log("Removes cloudSync from .hubble/config.json.");
}

function printUsage() {
	console.error("Usage:");
	console.error("  hubble [--cwd path] cloud create --name name [--url url]");
	console.error(
		"  hubble [--cwd path] cloud connect (--name name|--id id) [--url url]",
	);
	console.error("  hubble [--cwd path] cloud sync");
	console.error("  hubble [--cwd path] cloud watch");
	console.error("  hubble [--cwd path] cloud disconnect");
}

void main();
