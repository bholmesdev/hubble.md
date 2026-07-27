import { posix, win32 } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopApi = vi.hoisted(() => ({
	platform: "linux",
	pathExists: vi.fn(),
	realPath: vi.fn(),
	resolvePath: vi.fn(),
}));

vi.mock("../desktopApi", () => ({ desktopApi }));

import { resolveWorkspaceFilePath } from "./workspacePath";

describe("resolveWorkspaceFilePath", () => {
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

	it("returns a canonical path relative to the workspace", async () => {
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "/vault",
				basePath: "/vault/apps/dashboard",
				path: "../shared.md",
				mustExist: true,
			}),
		).resolves.toBe("apps/shared.md");
	});

	it("allows missing folders when their nearest existing ancestor is safe", async () => {
		desktopApi.pathExists.mockImplementation(
			async (path: string) => path === "/vault/apps",
		);
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "/vault",
				basePath: "/vault/apps",
				path: "new/items.md",
				mustExist: false,
			}),
		).resolves.toBe("apps/new/items.md");
	});

	it("handles Windows casing, separators, drive roots, and UNC paths", async () => {
		desktopApi.platform = "win32";
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "C:/Vault",
				basePath: "c:/vault/apps/dashboard",
				path: ".\\items.md",
				mustExist: true,
			}),
		).resolves.toBe("apps/dashboard/items.md");
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "//Server/Share/Vault",
				basePath: "//server/share/vault/apps",
				path: ".\\items.md",
				mustExist: true,
			}),
		).resolves.toBe("apps/items.md");
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "C:/",
				basePath: "C:/",
				path: "items.md",
				mustExist: true,
			}),
		).resolves.toBe("items.md");
	});

	it("rejects sibling paths with a shared prefix", async () => {
		desktopApi.platform = "win32";
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "C:/Vault",
				basePath: "c:/Vault-backup/apps",
				path: "items.md",
				mustExist: true,
			}),
		).rejects.toThrow("must stay inside the workspace");
	});

	it("keeps POSIX containment case-sensitive and supports root workspaces", async () => {
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "/Vault",
				basePath: "/vault/apps",
				path: "items.md",
				mustExist: true,
			}),
		).rejects.toThrow("must stay inside the workspace");
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "/",
				basePath: "/apps",
				path: "items.md",
				mustExist: true,
			}),
		).resolves.toBe("apps/items.md");
	});

	it("rejects paths that escape through traversal or symlinks", async () => {
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "/vault",
				basePath: "/vault/apps/dashboard",
				path: "../../../outside.md",
				mustExist: true,
			}),
		).rejects.toThrow("must stay inside the workspace");

		desktopApi.realPath.mockImplementation(async (path: string) =>
			path.endsWith("/items.md") ? "/outside/items.md" : path,
		);
		await expect(
			resolveWorkspaceFilePath({
				workspacePath: "/vault",
				basePath: "/vault/apps/dashboard",
				path: "items.md",
				mustExist: true,
			}),
		).rejects.toThrow("must stay inside the workspace");
	});
});
