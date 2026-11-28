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
		await expect(composer(page)).toBeVisible();
		await composer(page).fill("Remember this conversation");
		await composer(page).press("Enter");
		await expect(chat(page).getByRole("log")).toContainText("Remembered reply");
		await page
			.getByRole("tree")
			.getByRole("button", { name: "note.md", exact: true })
			.click();
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

test("collapses Chat before the file sidebar when the workspace container narrows", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-chat-layout-"));
	const workspace = path.join(root, "workspace");
	await fs.mkdir(workspace);
	let app: ElectronApplication | undefined;
	try {
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
		await page.getByRole("button", { name: "Folders", exact: true }).click();
		await expect(chat(page)).toBeVisible();
		const toggle = page.getByRole("button", {
			name: "Toggle sidebar",
			exact: true,
		});
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		const handle = chat(page).getByRole("separator", {
			name: "Resize chat panel",
		});
		const handleBox = await handle.boundingBox();
		if (!handleBox) throw new Error("Missing Chat resize handle");
		const startX = handleBox.x + handleBox.width / 2;
		const startY = handleBox.y + handleBox.height / 2;
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX - 80, startY, { steps: 5 });
		await page.mouse.up();
		await expect
			.poll(async () =>
				Math.abs(((await chat(page).boundingBox())?.width ?? 0) - 440),
			)
			.toBeLessThanOrEqual(2);
		const windowWidth = await page.evaluate(() => window.innerWidth);
		const narrow = (width: number) =>
			page.locator("main").evaluate((main, next) => {
				main.style.width = `${next}px`;
			}, width);
		await narrow(900);
		await expect(chat(page)).not.toBeVisible();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await narrow(600);
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator("[data-sidebar-overlay]")).toHaveCSS(
			"position",
			"absolute",
		);
		await page.getByRole("button", { name: "Open Chat", exact: true }).click();
		await expect(chat(page)).toBeVisible();
		await expect(chat(page)).toHaveCSS("position", "absolute");
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(await page.evaluate(() => window.innerWidth)).toBe(windowWidth);
	} finally {
		await app?.close();
		await fs.rm(root, { recursive: true, force: true });
	}
});
