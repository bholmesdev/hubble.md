import { posix, win32 } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopApi = vi.hoisted(() => ({
	platform: "linux",
	openExternalUrl: vi.fn(),
	pathExists: vi.fn(),
	realPath: vi.fn(),
	resolvePath: vi.fn(),
}));

vi.mock("../desktopApi", () => ({ desktopApi }));

import { handleHtmlAppRequest, resolveHtmlAppGlob } from "./IframeView";

const workspacePath = "/vault";
const htmlAppPath = "/vault/apps/project-dashboard/index.html";

describe("HTML app relative globs", () => {
	beforeEach(() => {
		desktopApi.pathExists.mockReset();
		desktopApi.realPath.mockReset();
		desktopApi.resolvePath.mockReset();
		desktopApi.platform = "linux";
		desktopApi.pathExists.mockResolvedValue(true);
		desktopApi.realPath.mockImplementation(async (path: string) => path);
		desktopApi.resolvePath.mockImplementation(async (path: string) => {
			const resolver = /^(?:[A-Za-z]:|[\\/]{2})/.test(path) ? win32 : posix;
			return resolver.resolve(path).replace(/\\/g, "/");
		});
	});

	it("translates dot-relative globs to canonical workspace globs", async () => {
		await expect(
			resolveHtmlAppGlob(workspacePath, htmlAppPath, "./*.md"),
		).resolves.toBe("apps/project-dashboard/*.md");
		await expect(
			resolveHtmlAppGlob(workspacePath, htmlAppPath, "../**/*.md"),
		).resolves.toBe("apps/**/*.md");
		await expect(
			resolveHtmlAppGlob(workspacePath, htmlAppPath, "**/*.md"),
		).resolves.toBe("**/*.md");
	});

	it("handles workspace roots and Windows separators", async () => {
		desktopApi.platform = "win32";
		await expect(
			resolveHtmlAppGlob("C:/Vault", "C:/Vault/index.html", "apps\\**\\*.md"),
		).resolves.toBe("apps/**/*.md");
		await expect(
			resolveHtmlAppGlob("C:/", "C:/index.html", ".\\*.md"),
		).resolves.toBe("*.md");
		await expect(
			resolveHtmlAppGlob("/", "/index.html", "./*.md"),
		).resolves.toBe("*.md");
	});

	it("rejects globs that escape the workspace", async () => {
		await expect(
			resolveHtmlAppGlob(workspacePath, htmlAppPath, "../../../*.md"),
		).rejects.toThrow("must stay inside the workspace");
	});
});

describe("HTML app external links", () => {
	beforeEach(() => {
		desktopApi.openExternalUrl.mockReset();
		desktopApi.openExternalUrl.mockResolvedValue(undefined);
	});

	const openLink = (url: unknown) =>
		handleHtmlAppRequest(
			{ type: "hubble:request", id: 1, method: "links.open", params: { url } },
			workspacePath,
			htmlAppPath,
		);

	it("opens http(s) URLs through the desktop external-URL API", async () => {
		await expect(openLink("https://example.com/docs")).resolves.toEqual({
			ok: true,
			value: { url: "https://example.com/docs" },
		});
		await expect(openLink("HTTP://example.com")).resolves.toMatchObject({
			ok: true,
		});
		expect(desktopApi.openExternalUrl).toHaveBeenCalledTimes(2);
		expect(desktopApi.openExternalUrl).toHaveBeenCalledWith(
			"https://example.com/docs",
		);
	});

	it("rejects non-http(s) URLs without calling the desktop API", async () => {
		for (const url of [
			"file:///etc/passwd",
			"javascript:alert(1)",
			"example.com",
			42,
		]) {
			const response = await openLink(url);
			expect(response.ok).toBe(false);
		}
		expect(desktopApi.openExternalUrl).not.toHaveBeenCalled();
	});

	it("keeps rejecting unknown methods", async () => {
		const response = await handleHtmlAppRequest(
			{ type: "hubble:request", id: 1, method: "links.close", params: {} },
			workspacePath,
			htmlAppPath,
		);
		expect(response).toMatchObject({
			ok: false,
			error: { message: "Unknown Hubble HTML app method: links.close" },
		});
	});
});
