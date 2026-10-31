import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	test,
} from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");

let app: ElectronApplication | null = null;
let root = "";

test.beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-e2e-"));
});

test.afterEach(async () => {
	await app?.close();
	app = null;
	await fs.rm(root, { recursive: true, force: true });
});

async function launch(args: string[], workspace?: string) {
	await app?.close();
	const { HUBBLE_DESKTOP_DEV_WORKSPACE: _, ...env } = process.env;
	app = await electron.launch({
		args: [appDir, ...args],
		env: {
			...env,
			// Keep the user's shell config out of the terminal.
			SHELL: "/bin/sh",
			HUBBLE_DESKTOP_DEV_USER_DATA: path.join(root, "user-data"),
			...(workspace && { HUBBLE_DESKTOP_DEV_WORKSPACE: workspace }),
		},
	});
	return app.firstWindow();
}

test("binds the first terminal to the file Hubble was launched with", async () => {
	const workspace = path.join(root, "workspace");
	const elsewhere = path.join(root, "elsewhere");
	await fs.mkdir(workspace);
	await fs.mkdir(elsewhere);
	await fs.writeFile(path.join(workspace, "restored.md"), "# Restored\n");
	const opened = path.join(elsewhere, "opened.md");
	await fs.writeFile(opened, "# Opened\n");
	const out = path.join(root, "note-path.txt");

	// Leave the terminal open on a restored note, like a previous session.
	let page = await launch([], workspace);
	await page
		.getByRole("tree")
		.getByRole("button", { name: "restored.md", exact: true })
		.click();
	await expect(page.locator(".ProseMirror")).toContainText("Restored");
	await app?.evaluate(({ BrowserWindow, Menu }) => {
		const item = Menu.getApplicationMenu()
			?.items.flatMap((menu) => menu.submenu?.items ?? [])
			.find((entry) => entry.label === "Toggle Terminal");
		item?.click(undefined, BrowserWindow.getAllWindows()[0], undefined);
	});
	await expect(page.locator(".xterm")).toBeVisible();

	// Cold launch with a file argument, as Finder's Open With does.
	page = await launch([opened]);
	await expect(page.locator(".ProseMirror")).toContainText("Opened");
	await page.locator(".xterm").click();
	await page.keyboard.type(`echo "$HUBBLE_NOTE_PATH" > '${out}'`);
	await page.keyboard.press("Enter");

	await expect
		.poll(() => fs.readFile(out, "utf8").catch(() => null), { timeout: 15_000 })
		.toBe(`${opened}\n`);
});
