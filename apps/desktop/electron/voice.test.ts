import { EventEmitter, once } from "node:events";
import { createConnection, type Socket } from "node:net";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { setupVoiceIpc } from "./voice";

const mocks = vi.hoisted(() => ({
	handlers: new Map(),
	spawn: vi.fn(),
	quit: undefined as undefined | (() => void),
}));
vi.mock("electron", () => ({
	app: {
		on: (_name, callback) => {
			mocks.quit = callback;
		},
		isPackaged: true,
		getAppPath: () => "/app",
	},
	ipcMain: {
		handle: (channel, callback) => mocks.handlers.set(channel, callback),
	},
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
const resourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
let client: Socket | undefined;
afterEach(() => {
	mocks.quit?.();
	client?.destroy();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (resourcesPath)
		Object.defineProperty(process, "resourcesPath", resourcesPath);
	else Reflect.deleteProperty(process, "resourcesPath");
});
it.each([
	{
		mode: "dev wrapper",
		forceDev: "1",
		bundle: "/app/out/native/Hubble Dictation.app",
	},
	{
		mode: "installed app",
		forceDev: "",
		bundle: "/installed/Resources/native/Hubble Dictation.app",
	},
])("launches $mode through macOS, streams results, and stops only the matching session", async ({
	forceDev,
	bundle,
}) => {
	vi.clearAllMocks();
	Object.defineProperty(process, "resourcesPath", {
		value: "/installed/Resources",
		configurable: true,
	});
	vi.stubEnv("HUBBLE_DESKTOP_FORCE_DEV", forceDev);
	const launcher = Object.assign(new EventEmitter(), { kill: vi.fn() });
	mocks.spawn.mockImplementation((_command, args) => {
		client = createConnection(args.at(-1));
		return launcher;
	});
	const sender = Object.assign(new EventEmitter(), {
		mainFrame: {},
		send: vi.fn(),
		isDestroyed: () => false,
	});
	const event = {
		sender,
		senderFrame: sender.mainFrame,
	} as unknown as IpcMainInvokeEvent;
	setupVoiceIpc(() => sender as unknown as WebContents);
	const start = mocks.handlers.get("desktop:voice-start");
	const stop = mocks.handlers.get("desktop:voice-stop");
	const id = crypto.randomUUID();
	await expect(start({ ...event, senderFrame: {} }, id)).rejects.toThrow(
		"main window",
	);
	expect(mocks.spawn).not.toHaveBeenCalled();
	if (process.platform !== "darwin") return;
	await start(event, id);
	expect(mocks.spawn).toHaveBeenCalledWith(
		"/usr/bin/open",
		[
			"-n",
			"-g",
			"-W",
			bundle,
			"--args",
			expect.stringMatching(/^\/tmp\/hubble-voice-.*\/speech.sock$/),
		],
		{ stdio: "ignore" },
	);
	if (!client) throw new Error("No native connection");
	await once(client, "connect");
	client.write('{"status":"listening","text":"hello"}\n');
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenCalledWith("desktop:voice", {
			id,
			status: "listening",
			text: "hello",
		}),
	);
	client.write(
		`${JSON.stringify({
			status: "listening",
			text: "First phrase.",
			settled: true,
			segments: [{ start: 0.2, end: 1, text: "First phrase." }],
		})}\n`,
	);
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id,
			status: "listening",
			text: "First phrase.",
		}),
	);
	client.write(
		`${JSON.stringify({
			status: "listening",
			text: "Second phrase.",
			segments: [{ start: 0, end: 0, text: "Second phrase." }],
		})}\n`,
	);
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id,
			status: "listening",
			text: "First phrase. Second phrase.",
		}),
	);
	client.write('{"status":"listening","level":0.65}\n');
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id,
			status: "listening",
			level: 0.65,
		}),
	);
	client.write(
		`${JSON.stringify({ status: "listening", session: 1, segments: [{ start: 0, end: 1, text: "Next session." }] })}\n`,
	);
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id,
			status: "listening",
			text: "First phrase. Second phrase. Next session.",
		}),
	);
	client.write(
		`${JSON.stringify({ status: "listening", session: 0, settled: true, segments: [{ start: 3, end: 4, text: "Second phrase!" }] })}\n`,
	);
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id,
			status: "listening",
			text: "First phrase. Second phrase! Next session.",
		}),
	);
	stop(event, "different-session");
	expect(client.read()).toBeNull();
	const command = once(client, "data");
	stop(event, id);
	expect((await command)[0].toString()).toBe("stop\n");
	client.end('{"status":"stopped"}\n');
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id,
			status: "stopped",
			text: "First phrase. Second phrase! Next session.",
		}),
	);
	expect(sender.listenerCount("render-process-gone")).toBe(0);
	await start(event, crypto.randomUUID());
	if (!client) throw new Error("No second native connection");
	await once(client, "connect");
	client.write(
		`${JSON.stringify({ status: "listening", text: "Hello", range: { start: 0, end: 1 } })}\n`,
	);
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id: expect.any(String),
			status: "listening",
			text: "Hello",
		}),
	);
	client.write(
		`${JSON.stringify({ status: "listening", text: "Hello, world.", range: { start: 0, end: 2 } })}\n`,
	);
	client.write(
		`${JSON.stringify({ status: "listening", text: " How are you?", range: { start: 2, end: 4 } })}\n`,
	);
	await vi.waitFor(() =>
		expect(sender.send).toHaveBeenLastCalledWith("desktop:voice", {
			id: expect.any(String),
			status: "listening",
			text: "Hello, world. How are you?",
		}),
	);
	const closed = once(client, "close");
	sender.emit("render-process-gone");
	await closed;
	expect(launcher.kill).toHaveBeenCalled();
});
