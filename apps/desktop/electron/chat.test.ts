import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
	handlers: new Map<string, (event: unknown) => unknown>(),
	app: { getPath: vi.fn(), on: vi.fn() },
	ipcMain: { handle: vi.fn() },
	safeStorage: {
		isEncryptionAvailable: vi.fn(),
		getSelectedStorageBackend: vi.fn(),
		encryptString: vi.fn(),
		decryptString: vi.fn(),
	},
	shell: { openExternal: vi.fn() },
}));
vi.mock("electron", () => electron);

import { setupChatIpc } from "./chat";

let folder: string;
const owner = { mainFrame: {} };
beforeEach(async () => {
	folder = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-chat-ipc-"));
	electron.handlers.clear();
	electron.app.getPath.mockReturnValue(folder);
	electron.ipcMain.handle.mockImplementation((channel, handler) =>
		electron.handlers.set(channel, handler),
	);
	electron.safeStorage.isEncryptionAvailable.mockReturnValue(true);
	electron.safeStorage.getSelectedStorageBackend.mockReturnValue(
		"gnome_libsecret",
	);
	electron.safeStorage.encryptString.mockImplementation((text) =>
		Buffer.from(text),
	);
	electron.safeStorage.decryptString.mockImplementation((bytes) =>
		bytes.toString(),
	);
	setupChatIpc(() => owner as never);
});
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	await fs.rm(folder, { recursive: true, force: true });
});
function call(channel: string, sender = owner, senderFrame = sender.mainFrame) {
	const handler = electron.handlers.get(channel);
	if (!handler) throw Error("Missing handler");
	return handler({ sender, senderFrame });
}

it("rejects account access from another window or a child frame", async () => {
	expect(() => call("desktop:chat-account", { mainFrame: {} })).toThrow(
		"Hubble window",
	);
	expect(() => call("desktop:chat-account", owner, {})).toThrow(
		"Hubble window",
	);
	expect(await call("desktop:chat-account")).toMatchObject({
		connected: false,
		label: null,
	});
});

it("refuses to persist credentials without OS encryption", async () => {
	electron.safeStorage.isEncryptionAvailable.mockReturnValue(false);
	await expect(call("desktop:chat-account")).rejects.toThrow("OS keychain");
	await expect(
		fs.access(path.join(folder, "chatgpt", "connection.enc")),
	).rejects.toThrow();
});

it("serializes account changes while allowing a pending sign-in to be cancelled", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_input, init) => {
			init.signal.throwIfAborted();
			return new Promise((_resolve, reject) =>
				init.signal.addEventListener(
					"abort",
					() => reject(init.signal.reason),
					{ once: true },
				),
			);
		}),
	);
	const pending = call("desktop:chat-sign-in");
	await expect(call("desktop:chat-reset")).rejects.toThrow("Finish or cancel");
	expect(await call("desktop:chat-account")).toMatchObject({ signingIn: true });
	call("desktop:chat-cancel-sign-in");
	await expect(pending).rejects.toThrow();
	await expect(call("desktop:chat-reset")).resolves.toBeUndefined();
});
