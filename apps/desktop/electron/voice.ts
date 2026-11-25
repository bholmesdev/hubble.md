import path from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import { z } from "zod";
import { launchDictation } from "./voiceHelper";

export function setupVoiceIpc(getContents: () => WebContents | undefined) {
	let active:
		| {
				id: string;
				helper: ReturnType<typeof launchDictation>;
				detach: () => void;
		  }
		| undefined;
	const cancel = () => {
		active?.helper.cancel();
		active?.detach();
		active = undefined;
	};
	app.on("before-quit", cancel);
	ipcMain.handle("desktop:voice-start", async (event, value: unknown) => {
		if (
			event.sender !== getContents() ||
			event.senderFrame !== event.sender.mainFrame
		)
			throw new Error("Dictation is only available in the main window.");
		const id = z.string().uuid().parse(value);
		if (process.platform !== "darwin")
			throw new Error("Dictation is currently available on macOS.");
		if (active)
			throw new Error(
				"Another recording is still stopping. Try again in a moment.",
			);
		const contents = event.sender;
		const isDev =
			!app.isPackaged || process.env.HUBBLE_DESKTOP_FORCE_DEV === "1";
		const bundle = path.join(
			isDev ? path.join(app.getAppPath(), "out") : process.resourcesPath,
			"native",
			"Hubble Dictation.app",
		);
		const navigate = (
			_event: Electron.Event,
			_url: string,
			_inPlace: boolean,
			mainFrame: boolean,
		) => {
			if (mainFrame) cancel();
		};
		const detach = () => {
			contents.off("destroyed", cancel);
			contents.off("render-process-gone", cancel);
			contents.off("did-start-navigation", navigate);
		};
		const helper = launchDictation(bundle, (result) => {
			if (!contents.isDestroyed())
				contents.send("desktop:voice", { ...result, id });
			if (result.status === "stopped" || result.status === "error") {
				if (active?.id === id) active = undefined;
				detach();
			}
		});
		active = { id, helper, detach };
		contents.once("destroyed", cancel);
		contents.once("render-process-gone", cancel);
		contents.on("did-start-navigation", navigate);
		await helper.ready;
	});
	ipcMain.handle("desktop:voice-stop", (event, id: unknown) => {
		if (
			event.sender !== getContents() ||
			event.senderFrame !== event.sender.mainFrame
		)
			return;
		if (active?.id === id) active.helper.stop();
	});
}
