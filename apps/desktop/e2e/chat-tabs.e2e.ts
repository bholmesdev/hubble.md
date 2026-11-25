import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat" });
const composer = (page: Page) =>
	chat(page).getByRole("textbox", { name: "Message Chat", exact: true });

// Keep real preload, rendering, and persistence without account credentials or network requests.
async function fakeChat(app: ElectronApplication) {
	await app.evaluate(({ ipcMain }) => {
		for (const name of ["account", "models", "send"])
			ipcMain.removeHandler(`desktop:chat-${name}`);
		ipcMain.handle("desktop:chat-account", () => ({
			connected: true,
			sharing: true,
			label: "E2E account",
			expiresAt: Date.now() + 3600000,
		}));
		ipcMain.handle("desktop:chat-models", () => [
			{ slug: "test-model", name: "Test model" },
		]);
		ipcMain.handle("desktop:chat-send", () => ({
			status: "complete",
			text: "Remembered reply",
		}));
	});
}

test("restores a tab’s conversation and draft after restarting Electron", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-chat-restart-"));
	const workspace = path.join(root, "workspace");
	await fs.mkdir(workspace);
	await fs.writeFile(path.join(workspace, "note.md"), "# Note\n\nTest note.\n");
	let app: ElectronApplication | undefined;
	async function launch() {
		app = await electron.launch({
			args: [appDir],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: "",
				HUBBLE_DESKTOP_DEV_USER_DATA: path.join(root, "user-data"),
				HUBBLE_DESKTOP_DEV_WORKSPACE: workspace,
			},
		});
		const page = await app.firstWindow();
		await fakeChat(app);
		await page.reload();
		await page.getByRole("button", { name: "Folders", exact: true }).click();
		return page;
	}
	try {
		let page = await launch();
		await expect(chat(page)).toBeHidden();
		await page
			.getByRole("tree")
			.getByRole("button", { name: "note.md", exact: true })
			.click();
		await composer(page).fill("Remember this conversation");
		await chat(page)
			.getByRole("button", { name: "Send message", exact: true })
			.click();
		await expect(chat(page).getByRole("log")).toContainText("Remembered reply");
		await composer(page).fill("Unsent draft");
		await app?.close();
		page = await launch();
		await expect(composer(page)).toHaveText("Unsent draft");
		await expect(chat(page).getByRole("log")).toContainText(
			"Remember this conversation",
		);
		await expect(chat(page).getByRole("log")).toContainText("Remembered reply");
	} finally {
		await app?.close();
		await fs.rm(root, { recursive: true, force: true });
	}
});
