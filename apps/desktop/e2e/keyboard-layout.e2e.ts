import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { DesktopApi } from "../src/desktopApi/types";

test("keeps editor shortcuts in sync with live layout changes and renderer reloads", async () => {
	test.skip(
		process.platform !== "darwin",
		"The hybrid Command layout is macOS-only",
	);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-keyboard-e2e-"));
	const workspace = path.join(root, "workspace");
	await fs.mkdir(workspace);
	await fs.writeFile(path.join(workspace, "note.md"), "Hello\n");
	const app = await electron.launch({
		args: [path.resolve(import.meta.dirname, "..")],
		env: {
			...process.env,
			HUBBLE_DESKTOP_BACKGROUND: "1",
			HUBBLE_DESKTOP_DEV_USER_DATA: path.join(root, "user-data"),
			HUBBLE_DESKTOP_DEV_WORKSPACE: workspace,
		},
	});
	try {
		const page = await app.firstWindow();
		await page
			.getByRole("tree")
			.getByRole("button", { name: "note.md", exact: true })
			.click();
		const editor = page.locator(".ProseMirror");
		await expect(editor).toContainText("Hello");

		const readMode = () =>
			page.evaluate(() => {
				let current: boolean | null = null;
				const api = (window as unknown as { desktopApi: DesktopApi })
					.desktopApi;
				const stop = api.onKeyboardLayoutChange((enabled) => {
					current = enabled;
				});
				stop();
				return current;
			});
		expect(typeof (await readMode())).toBe("boolean");

		// Simulate native notifications without changing the user's actual input source.
		await app.evaluate(({ BrowserWindow, ipcMain }) => {
			ipcMain.removeAllListeners("desktop:keyboard-layout");
			ipcMain.on("desktop:keyboard-layout", (event) => {
				event.returnValue = false;
			});
			BrowserWindow.getAllWindows()[0]?.webContents.send(
				"desktop:keyboard-layout-change",
				false,
			);
		});
		await editor.click();
		await page.keyboard.press("Meta+a");
		await editor.dispatchEvent("keydown", {
			key: "b",
			code: "KeyN",
			metaKey: true,
		});
		await expect(editor.locator("strong")).toHaveText("Hello");

		await app.evaluate(({ BrowserWindow, ipcMain }) => {
			ipcMain.removeAllListeners("desktop:keyboard-layout");
			ipcMain.on("desktop:keyboard-layout", (event) => {
				event.returnValue = true;
			});
			BrowserWindow.getAllWindows()[0]?.webContents.send(
				"desktop:keyboard-layout-change",
				true,
			);
		});
		await editor.dispatchEvent("keydown", {
			key: "x",
			code: "KeyB",
			metaKey: true,
		});
		await expect(editor.locator("strong")).toHaveCount(0);

		await page.reload();
		await expect(editor).toContainText("Hello");
		expect(await readMode()).toBe(true);
	} finally {
		await app.close();
		await fs.rm(root, { recursive: true, force: true });
	}
});
