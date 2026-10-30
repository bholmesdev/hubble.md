import { expect, test } from "@playwright/test";

// Exercise the real www bundle and shared Sidebar, with an isolated Convex
// transport fixture so the smoke test never reads or writes a live workspace.
test("web sidebar selection, sorting, menus, scrolling, and narrow layout", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const files = Array.from({ length: 40 }, (_, i) => ({
		path:
			i === 0 ? "Projects/alpha.md" : `note-${String(i).padStart(2, "0")}.md`,
		content: `# Note ${i}\n\nSample body ${i}`,
		contentHash: `hash-${i}`,
		updatedAt: Date.now() - i * 1000,
		deleted: false,
	}));
	await page.route(
		"https://sidebar-smoke.convex.cloud/api/**",
		async (route) => {
			const request = route.request().postDataJSON();
			let value: unknown;
			if (request.path === "sync:listWorkspaces")
				value = [{ _id: "smoke", name: "Sidebar smoke" }];
			else if (request.path === "sync:getFilesByWorkspace") value = files;
			else if (request.path === "sync:getAssetsByWorkspace") value = [];
			else throw new Error(`Unexpected backend request: ${request.path}`);
			await route.fulfill({ json: { status: "success", value } });
		},
	);
	await page.routeWebSocket("wss://sidebar-smoke.convex.cloud/**", () => {});
	await page.addInitScript(() => {
		localStorage.setItem(
			"hubble.connection.url",
			"https://sidebar-smoke.convex.cloud",
		);
		localStorage.setItem("hubble.connection.workspaceId", "smoke");
	});
	await page.setViewportSize({ width: 1200, height: 800 });
	await page.goto("/w/smoke");
	const tree = page.getByRole("tree");
	await expect(tree).toBeVisible();
	const note = tree.getByRole("button", { name: "note-01.md", exact: true });
	await note.click();
	await expect(page.locator(".ProseMirror")).toContainText("Sample body 1");
	await expect(
		tree.getByRole("treeitem", { name: /^note-01\.md/ }),
	).toHaveAttribute("aria-current", "page");
	// Opening another file by URL also synchronizes the tree selection.
	await page.goto("/w/smoke/f/note-02.md");
	await expect(page.locator(".ProseMirror")).toContainText("Sample body 2");
	await expect(
		tree.getByRole("treeitem", { name: /^note-02\.md/ }),
	).toHaveAttribute("aria-current", "page");
	await tree.getByRole("button", { name: "Projects", exact: true }).click();
	await tree.getByRole("button", { name: "alpha.md", exact: true }).click();
	await expect(page.locator(".ProseMirror")).toContainText("Sample body 0");
	await page
		.getByRole("combobox", { name: "Sort files: Recent", exact: true })
		.click();
	await page.getByRole("option", { name: "Name", exact: true }).click();
	await expect(
		page.getByRole("combobox", { name: "Sort files: Name", exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Sidebar smoke", exact: true })
		.click();
	await expect(
		page.getByRole("menuitem", { name: "Disconnect", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu", { includeHidden: true })).toHaveCount(0);
	await expect(
		page.getByRole("combobox", { name: "Sort files: Name", exact: true }),
	).toHaveAttribute("aria-expanded", "false");
	await tree.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect
		.poll(() => tree.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
	await page.screenshot({
		path: testInfo.outputPath("web-sidebar-wide.png"),
		animations: "disabled",
	});
	await page.setViewportSize({ width: 520, height: 800 });
	await expect(tree).toBeVisible();
	await expect(
		page.getByRole("combobox", { name: "Sort files: Name", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("web-sidebar-compact.png"),
		animations: "disabled",
	});
	expect(errors).toEqual([]);
});
