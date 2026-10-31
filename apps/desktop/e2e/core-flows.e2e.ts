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

test("draws a shape in a diagram and saves it", async ({ hubble }) => {
	const file = path.join(hubble.workspace, "flow.tldr");
	await fs.writeFile(file, "");
	const page = await hubble.launch();

	// Builds without a tldraw license key leave diagrams out, and opening a
	// .tldr file there hands it to another app.
	await page.getByRole("button", { name: "New file" }).click();
	const diagramsEnabled = await page
		.getByRole("menuitem", { name: "New Diagram" })
		.isVisible();
	await page.keyboard.press("Escape");
	test.skip(!diagramsEnabled, "This build has no tldraw license key.");

	await sidebarFile(page, "flow.tldr").click();
	const canvas = page.locator("[data-hubble-diagram] .tl-canvas");
	await expect(canvas).toBeVisible();
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Diagram canvas has no size");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await page.keyboard.press("r");
	await page.mouse.move(box.x + 200, box.y + 150);
	await page.mouse.down();
	await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
	await page.mouse.up();

	await expect(page.locator(".tl-shape")).toHaveCount(1);
	await expect
		.poll(async () => {
			const saved = JSON.parse((await readDisk(file)) || "{}");
			return (saved.records ?? []).filter(
				(record: { typeName: string; type?: string }) =>
					record.typeName === "shape" && record.type === "geo",
			).length;
		})
		.toBe(1);
});
