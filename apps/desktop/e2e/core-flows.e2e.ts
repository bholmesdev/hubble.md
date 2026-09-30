import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	test as base,
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
} from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");

type Hubble = {
	workspace: string;
	launch: (options?: { openWorkspace?: boolean }) => Promise<Page>;
	close: () => Promise<void>;
};

const test = base.extend<{ hubble: Hubble }>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture args.
	hubble: async ({}, use) => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-e2e-"));
		const workspace = path.join(root, "workspace");
		await fs.mkdir(workspace);
		await fs.writeFile(
			path.join(workspace, "existing.md"),
			"# Existing\n\nHello\n",
		);
		let app: ElectronApplication | null = null;
		const close = async () => {
			await app?.close();
			app = null;
		};
		await use({
			workspace,
			// Relaunches share user data, so persisted session state carries over.
			launch: async ({ openWorkspace = true } = {}) => {
				await close();
				// Drop any inherited workspace so relaunch tests prove session restore.
				const { HUBBLE_DESKTOP_DEV_WORKSPACE: _, ...env } = process.env;
				app = await electron.launch({
					args: [appDir],
					env: {
						...env,
						HUBBLE_DESKTOP_DEV_USER_DATA: path.join(root, "user-data"),
						...(openWorkspace && { HUBBLE_DESKTOP_DEV_WORKSPACE: workspace }),
					},
				});
				return app.firstWindow();
			},
			close,
		});
		await close();
		await fs.rm(root, { recursive: true, force: true });
	},
});

const editor = (page: Page) => page.locator(".ProseMirror");
const sidebarFile = (page: Page, name: string) =>
	page.getByRole("tree").getByRole("button", { name, exact: true });

async function readDisk(file: string) {
	return fs.readFile(file, "utf8").catch(() => null);
}

test("creates a note and saves typed content to disk", async ({ hubble }) => {
	const page = await hubble.launch();
	await page.getByRole("button", { name: "New file" }).click();
	await page.getByRole("menuitem", { name: "New Note" }).click();
	await editor(page).click();
	await page.keyboard.type("Groceries");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Buy oat milk");

	await expect
		.poll(() => readDisk(path.join(hubble.workspace, "groceries.md")))
		.toBe("Groceries\n\nBuy oat milk");
});

test("edits an existing note and saves it", async ({ hubble }) => {
	const page = await hubble.launch();
	await sidebarFile(page, "existing.md").click();
	await expect(editor(page)).toContainText("Hello");
	await editor(page).getByText("Hello").click();
	await page.keyboard.press("End");
	await page.keyboard.type(" world");

	await expect
		.poll(() => readDisk(path.join(hubble.workspace, "existing.md")))
		.toBe("# Existing\n\nHello world");
});

test("renames a note from the sidebar and keeps it open", async ({
	hubble,
}) => {
	const page = await hubble.launch();
	await sidebarFile(page, "existing.md").click();
	await expect(editor(page)).toContainText("Hello");

	await page.getByRole("button", { name: "Actions for existing.md" }).click();
	await page.getByRole("menuitem", { name: "Rename" }).click();
	const input = page.getByRole("tree").getByRole("textbox");
	await input.fill("renamed");
	await input.press("Enter");

	await expect
		.poll(() => readDisk(path.join(hubble.workspace, "renamed.md")))
		.toBe("# Existing\n\nHello\n");
	expect(await readDisk(path.join(hubble.workspace, "existing.md"))).toBeNull();
	await expect(
		page.getByRole("treeitem", { name: /^renamed\.md/ }),
	).toHaveAttribute("aria-current", "page");
	await expect(editor(page)).toContainText("Hello");
});

test("reopens the workspace and note after relaunch", async ({ hubble }) => {
	let page = await hubble.launch();
	await sidebarFile(page, "existing.md").click();
	await expect(editor(page)).toContainText("Hello");
	await hubble.close();

	page = await hubble.launch({ openWorkspace: false });
	await expect(sidebarFile(page, "existing.md")).toBeVisible();
	await expect(editor(page)).toContainText("Hello");
});
