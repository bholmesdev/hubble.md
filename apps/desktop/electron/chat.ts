import path from "node:path";
import { app, ipcMain, safeStorage, shell, type WebContents } from "electron";
import { ChatGPTAuth } from "./chatAuth";

export function setupChatIpc(getContents: () => WebContents | undefined) {
	const auth = new ChatGPTAuth({
		storagePath: path.join(
			app.getPath("userData"),
			"chatgpt",
			"connection.enc",
		),
		encrypt: (text) => {
			assertEncryption();
			return safeStorage.encryptString(text);
		},
		decrypt: (bytes) => {
			assertEncryption();
			return safeStorage.decryptString(bytes);
		},
		openBrowser: async (url) => {
			await shell.openExternal(url);
		},
	});
	let accountBusy = false;
	function handle(channel: string, action: () => unknown) {
		ipcMain.handle(channel, (event) => {
			if (
				event.sender !== getContents() ||
				event.senderFrame !== event.sender.mainFrame
			)
				throw Error("Chat is only available in the Hubble window.");
			return action();
		});
	}
	async function changeAccount<T>(action: () => Promise<T>) {
		if (accountBusy) throw Error("Finish or cancel sign-in first.");
		accountBusy = true;
		try {
			return await action();
		} finally {
			accountBusy = false;
		}
	}
	handle("desktop:chat-account", async () => ({
		...(await auth.account()),
		signingIn: auth.signingIn,
		busy: accountBusy,
	}));
	handle("desktop:chat-sign-in", () => changeAccount(() => auth.signIn()));
	handle("desktop:chat-cancel-sign-in", () => auth.cancel());
	handle("desktop:chat-reset", () => changeAccount(() => auth.reset()));
	handle("desktop:chat-disconnect", () =>
		changeAccount(() => auth.disconnect()),
	);
	app.on("before-quit", () => auth.cancel());
}

function assertEncryption() {
	if (
		!safeStorage.isEncryptionAvailable() ||
		(process.platform === "linux" &&
			safeStorage.getSelectedStorageBackend() === "basic_text")
	)
		throw Error(
			"Chat sign-in needs an OS keychain. Unlock or configure your keychain and restart Hubble.",
		);
}
