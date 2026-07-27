import { desktopApi } from "../desktopApi";
import { dirname, joinPath, normalizePath } from "./filePath";

/**
 * Resolves a file path from any folder and returns its path from the workspace
 * root. Paths outside the workspace are rejected, including through symlinks.
 */
export async function resolveWorkspaceFilePath({
	workspacePath,
	basePath,
	path,
	mustExist,
}: {
	workspacePath: string;
	basePath: string;
	path: string;
	mustExist: boolean;
}) {
	const absolutePath = await desktopApi.resolvePath(joinPath(basePath, path));
	await assertPathInWorkspace(workspacePath, absolutePath, { mustExist });
	const absoluteWorkspace = await desktopApi.resolvePath(workspacePath);
	const relativePath = relativePathWithin(absoluteWorkspace, absolutePath);
	if (relativePath === null) {
		throw new Error("File path must stay inside the workspace.");
	}
	return normalizePath(relativePath);
}

/**
 * Rejects an existing path outside the workspace. For a new file, checks its
 * nearest existing parent so missing folders can still be created safely.
 */
export async function assertPathInWorkspace(
	workspacePath: string,
	absolutePath: string,
	options: { mustExist: boolean },
) {
	const parentPath = dirname(absolutePath);
	const targetPath = options.mustExist
		? absolutePath
		: await nearestExistingAncestor(parentPath);
	if (!targetPath) {
		throw new Error("File path must stay inside the workspace.");
	}
	const [realWorkspacePath, realTargetPath] = await Promise.all([
		desktopApi.realPath(workspacePath),
		desktopApi.realPath(targetPath),
	]);
	if (relativePathWithin(realWorkspacePath, realTargetPath) === null) {
		throw new Error("File path must stay inside the workspace.");
	}
}

/** Returns a path from the given root, or null when the path is outside it. */
export function relativePathWithin(
	rootPath: string,
	path: string,
): string | null {
	const root = normalizePath(rootPath);
	const candidate = normalizePath(path);
	// Windows ignores case, but keep the original spelling in the result.
	const ignoreCase = desktopApi.platform === "win32";
	const comparedRoot = ignoreCase ? root.toLowerCase() : root;
	const comparedCandidate = ignoreCase ? candidate.toLowerCase() : candidate;
	if (comparedCandidate === comparedRoot) return "";
	if (comparedRoot === "/") {
		return comparedCandidate.startsWith("/") ? candidate.slice(1) : null;
	}
	if (!comparedCandidate.startsWith(`${comparedRoot}/`)) return null;
	return candidate.slice(root.length + 1);
}

async function nearestExistingAncestor(path: string | null) {
	let current = path;
	while (current) {
		if (await desktopApi.pathExists(current)) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
}
