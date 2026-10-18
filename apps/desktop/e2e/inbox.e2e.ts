import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture args.
test("inbox groups, navigation, live previews, and wide/compact layouts", async ({}, testInfo) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-inbox-"));
	const workspace = path.join(root, "Inbox demo");
	await fs.mkdir(path.join(workspace, "Projects"), { recursive: true });
	await fs.mkdir(path.join(workspace, ".hubble"));
	await fs.writeFile(
		path.join(workspace, ".hubble/config.json"),
		JSON.stringify({ version: 1, pinnedNotes: ["Projects/launch.md"] }),
	);
	const entries = [
		[
			"Projects/launch.md",
			"# Launch checklist\n\nReview the launch plan with the team.",
			0,
		],
		["daily.md", "# Weekend ideas\n\nA walk by the river and a new recipe.", 0],
		[
			"Projects/meeting.md",
			"# Design review\n\nKeep the sidebar clear at every window size.",
			1,
		],
		["reading.md", "# Reading list\n\nSmall tools, thoughtful interfaces.", 4],
		["dashboard.html", "<h1>Project dashboard</h1>", 10],
	] as const;
	for (const [name, content, daysAgo] of entries) {
		const file = path.join(workspace, name);
		await fs.writeFile(file, content);
		const date = new Date();
		date.setDate(date.getDate() - daysAgo);
		await fs.utimes(file, date, date);
	}
	const app = await electron.launch({
		args: [path.resolve(import.meta.dirname, "..")],
		env: {
			...process.env,
			HUBBLE_DESKTOP_DEV_USER_DATA: path.join(root, "user-data"),
			HUBBLE_DESKTOP_DEV_WORKSPACE: workspace,
		},
	});
	try {
		const page = await app.firstWindow();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].setSize(1200, 820),
		);
		await page.getByRole("button", { name: "Disable", exact: true }).click();
		await page.getByRole("button", { name: "Inbox", exact: true }).click();
		const nav = page.getByRole("navigation", { name: "Recent files" });
		await expect(
			nav.getByRole("heading", { name: "Pinned", exact: true }),
		).toBeVisible();
		await expect(
			nav.getByRole("heading", { name: "Yesterday", exact: true }),
		).toBeVisible();
		await expect(
			nav.getByRole("heading", { name: "Previous 7 Days", exact: true }),
		).toBeVisible();
		await expect(nav.getByText("HTML App", { exact: true })).toBeVisible();
		const row = nav
			.locator("[data-inbox-path]")
			.filter({ hasText: "Weekend ideas" });
		await row.click();
		await expect(page.locator(".ProseMirror")).toContainText(
			"A walk by the river",
		);
		await expect(row).toHaveAttribute("aria-current", "page");
		await row.focus();
		await page.keyboard.press("ArrowDown");
		await expect(page.locator(".ProseMirror")).toContainText(
			"Keep the sidebar clear",
		);
		await row.click();
		await page
			.locator(".ProseMirror")
			.getByText("Weekend ideas", { exact: true })
			.click();
		await page.keyboard.press("End");
		await page.keyboard.type(" for autumn");
		await expect(nav).toContainText("Weekend ideas for autumn");
		await page.screenshot({ path: testInfo.outputPath("inbox-wide.png") });
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].setSize(520, 820),
		);
		await expect(nav).not.toBeVisible();
		await page
			.getByRole("button", { name: "Toggle sidebar", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Inbox", exact: true }),
		).toBeVisible();
		await expect
			.poll(() =>
				page
					.locator("[data-sidebar-root]")
					.evaluate((element) =>
						Math.round(element.getBoundingClientRect().left),
					),
			)
			.toBe(0);
		await page.screenshot({ path: testInfo.outputPath("inbox-compact.png") });
		await nav
			.locator("[data-inbox-path]")
			.filter({ hasText: "Design review" })
			.click();
		await expect(nav).not.toBeVisible();
		await expect(page.locator(".ProseMirror")).toContainText(
			"Keep the sidebar clear",
		);
		expect(errors).toEqual([]);
	} finally {
		await app.close();
		await fs.rm(root, { recursive: true, force: true });
	}
});
