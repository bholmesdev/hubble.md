import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import type {
	DirectoryListing,
	FileEntry,
	HtmlAppFileEntry,
	WorkspaceDelta,
} from "../src/desktopApi/types";
import {
	fileKindForPath,
	HUBBLE_DIR,
	isHiddenSidebarFolderName,
	isVisibleSidebarFileName,
} from "../src/lib/filePath";

type IgnoreRule = {
	dir: string;
	matcher: ReturnType<typeof ignore>;
};

type SidebarWalk = {
	rootRealPath: string;
	ancestors: Set<string>;
};

const ignoreConfigFiles = [".gitignore", ".ignore"];
const ignoredWorkspaceDirs = new Set([".git", "dist", "node_modules"]);

/** Lists every sidebar-visible file and folder under the workspace root. */
export async function listSidebarFiles(
	root: string,
): Promise<DirectoryListing> {
	const listing: DirectoryListing = { files: [], folders: [] };
	const rootRealPath = await fs.realpath(root);
	await collectSidebarFiles(root, listing, [], {
		rootRealPath,
		ancestors: new Set([rootRealPath]),
	});
	return listing;
}

/**
 * Turns one watcher-reported path into a sidebar delta: upsert the file,
 * relist the affected subtree, remove the entry, or fall back to a full
 * refresh when the change cannot be resolved.
 */
export async function sidebarDeltaForPath(
	root: string,
	changedPath: string,
): Promise<WorkspaceDelta> {
	const resolvedRoot = path.resolve(root);
	const resolvedPath = path.resolve(changedPath);
	if (!isWithin(resolvedRoot, resolvedPath)) return { kind: "refresh" };
	if (resolvedPath === resolvedRoot) return { kind: "refresh" };

	// An edited ignore file can hide or reveal anything in its folder.
	if (ignoreConfigFiles.includes(path.basename(resolvedPath))) {
		const target = path.dirname(resolvedPath);
		const rootRealPath = await fs.realpath(resolvedRoot);
		if (await hasExternalSymlink(resolvedRoot, rootRealPath, target)) {
			return { kind: "remove", path: toPosixPath(resolvedPath) };
		}
		const listing = await listSidebarSubtree(resolvedRoot, target);
		return {
			kind: "subtree",
			path: toPosixPath(target),
			listing,
		};
	}

	let stat: Awaited<ReturnType<typeof fs.lstat>>;
	try {
		stat = await fs.lstat(resolvedPath);
	} catch (error) {
		if (isMissingPathError(error)) {
			return { kind: "remove", path: toPosixPath(resolvedPath) };
		}
		return { kind: "refresh" };
	}

	const rootRealPath = await fs.realpath(resolvedRoot);
	if (await hasExternalSymlink(resolvedRoot, rootRealPath, resolvedPath)) {
		return { kind: "remove", path: toPosixPath(resolvedPath) };
	}
	if (stat.isDirectory() || stat.isSymbolicLink()) {
		if (!(await directoryRealPath(rootRealPath, resolvedPath, stat))) {
			return { kind: "remove", path: toPosixPath(resolvedPath) };
		}
		const listing = await listSidebarSubtree(resolvedRoot, resolvedPath);
		return {
			kind: "subtree",
			path: toPosixPath(resolvedPath),
			listing,
		};
	}
	if (stat.isFile()) return fileDelta(resolvedRoot, resolvedPath);
	return { kind: "remove", path: toPosixPath(resolvedPath) };
}

/** Collects workspace files matching a glob, for the HTML app file listing. */
export async function collectWorkspaceFiles(
	root: string,
	dir: string,
	glob: string,
	out: HtmlAppFileEntry[],
	inheritedRules: IgnoreRule[] = [],
) {
	const rules = await rulesForDir(dir, inheritedRules);
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (isIgnoredByRules(entryPath, rules)) continue;
		const relativePath = path
			.relative(root, entryPath)
			.split(path.sep)
			.join("/");
		if (
			relativePath === HUBBLE_DIR ||
			relativePath.startsWith(`${HUBBLE_DIR}/`)
		)
			continue;
		if (entry.isDirectory()) {
			await collectWorkspaceFiles(root, entryPath, glob, out, rules);
			continue;
		}
		if (!matchesGlob(relativePath, glob)) continue;
		const stat = await fs.stat(entryPath);
		out.push({
			name: entry.name,
			path: relativePath,
			modified_at: Math.floor(stat.mtimeMs / 1000),
			size: stat.size,
		});
	}
}

/** Recursive sidebar walk, skipping ignored entries and symlink cycles. */
async function collectSidebarFiles(
	dir: string,
	out: DirectoryListing,
	inheritedRules: IgnoreRule[],
	walk: SidebarWalk,
) {
	const rules = await rulesForDir(dir, inheritedRules);
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (isIgnoredByRules(entryPath, rules)) continue;

		let stat: Awaited<ReturnType<typeof fs.lstat>>;
		try {
			stat = await fs.lstat(entryPath);
		} catch (error) {
			if (isMissingPathError(error)) continue;
			throw error;
		}

		const realDirectory = await directoryRealPath(
			walk.rootRealPath,
			entryPath,
			stat,
		);
		if (realDirectory) {
			if (isHiddenSidebarFolderName(entry.name)) continue;
			if (walk.ancestors.has(realDirectory)) continue;
			out.folders.push({
				path: toPosixPath(entryPath),
				modified_at: Math.floor(stat.mtimeMs / 1000),
			});
			await collectSidebarFiles(entryPath, out, rules, {
				rootRealPath: walk.rootRealPath,
				ancestors: new Set([...walk.ancestors, realDirectory]),
			});
		} else if (stat.isFile() && isVisibleSidebarFileName(entry.name)) {
			out.files.push({
				path: toPosixPath(entryPath),
				modified_at: Math.floor(stat.mtimeMs / 1000),
				kind: fileKindForPath(entry.name),
			});
		}
	}
}

/** Relists one folder for a subtree delta; empty when it is not visible. */
async function listSidebarSubtree(
	root: string,
	target: string,
): Promise<DirectoryListing> {
	const listing: DirectoryListing = { files: [], folders: [] };
	const rootRealPath = await fs.realpath(root);
	const inheritedRules =
		target === root ? [] : await rulesFromRoot(root, path.dirname(target));
	let targetRealPath = rootRealPath;

	if (target !== root) {
		const stat = await fs.lstat(target);
		targetRealPath =
			(await directoryRealPath(rootRealPath, target, stat)) ?? "";
		if (
			!targetRealPath ||
			targetRealPath === rootRealPath ||
			!isVisibleSidebarPath(root, target, inheritedRules)
		) {
			return listing;
		}
		listing.folders.push({
			path: toPosixPath(target),
			modified_at: Math.floor(stat.mtimeMs / 1000),
		});
	}

	await collectSidebarFiles(target, listing, inheritedRules, {
		rootRealPath,
		ancestors: new Set([rootRealPath, targetRealPath]),
	});
	return listing;
}

/** Delta for a single changed file: upsert when visible, remove otherwise. */
async function fileDelta(
	root: string,
	filePath: string,
): Promise<WorkspaceDelta> {
	const name = path.basename(filePath);
	if (!isVisibleSidebarFileName(name)) {
		return { kind: "remove", path: toPosixPath(filePath) };
	}
	const rules = await rulesFromRoot(root, path.dirname(filePath));
	if (!isVisibleSidebarPath(root, filePath, rules)) {
		return { kind: "remove", path: toPosixPath(filePath) };
	}
	const stat = await fs.lstat(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		return { kind: "remove", path: toPosixPath(filePath) };
	}
	const entry: FileEntry = {
		path: toPosixPath(filePath),
		modified_at: Math.floor(stat.mtimeMs / 1000),
		kind: fileKindForPath(name),
	};
	return { kind: "file", entry };
}

/** Appends the dir's own ignore-file rules to the inherited chain. */
async function rulesForDir(dir: string, inherited: IgnoreRule[]) {
	const matcher = ignore();
	let hasRules = false;

	for (const fileName of ignoreConfigFiles) {
		try {
			matcher.add(await fs.readFile(path.join(dir, fileName), "utf8"));
			hasRules = true;
		} catch (error) {
			if (isMissingPathError(error)) continue;
			throw error;
		}
	}

	return hasRules ? [...inherited, { dir, matcher }] : inherited;
}

/** Builds the ignore-rule chain from the workspace root down to dir. */
async function rulesFromRoot(root: string, dir: string) {
	if (!isWithin(root, dir)) throw new Error("Path is outside workspace");

	const relative = path.relative(root, dir);
	const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
	let current = root;
	let rules: IgnoreRule[] = [];
	for (const segment of ["", ...segments]) {
		if (segment) current = path.join(current, segment);
		rules = await rulesForDir(current, rules);
	}
	return rules;
}

function isIgnoredByRules(candidatePath: string, rules: IgnoreRule[]) {
	if (isIgnoredWorkspacePath(candidatePath)) return true;

	let ignored = false;
	for (const { dir, matcher } of rules) {
		const relative = path.relative(dir, candidatePath);
		if (
			relative === "" ||
			relative.startsWith("..") ||
			path.isAbsolute(relative)
		)
			continue;
		const ignorePath = toPosixPath(relative);
		const result = matcher.test(ignorePath);
		const directoryResult = matcher.test(`${ignorePath}/`);
		if (result.ignored || directoryResult.ignored) ignored = true;
		if (result.unignored || directoryResult.unignored) ignored = false;
	}
	return ignored;
}

/** Covers always-ignored workspace dirs in case Git ignores do not catch them. */
function isIgnoredWorkspacePath(candidatePath: string): boolean {
	return candidatePath
		.split(/[\\/]+/)
		.some((segment) => ignoredWorkspaceDirs.has(segment));
}

function hasHiddenSidebarFolder(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative
		.split(path.sep)
		.filter(Boolean)
		.some(isHiddenSidebarFolderName);
}

function isVisibleSidebarPath(
	root: string,
	candidate: string,
	rules: IgnoreRule[],
): boolean {
	return (
		!hasHiddenSidebarFolder(root, candidate) &&
		!isIgnoredByRules(candidate, rules)
	);
}

/** Real path of an entry when it is a directory inside the root, else null. */
async function directoryRealPath(
	rootRealPath: string,
	entryPath: string,
	lstat: Awaited<ReturnType<typeof fs.lstat>>,
): Promise<string | null> {
	let stat = lstat;
	if (stat.isSymbolicLink()) {
		try {
			stat = await fs.stat(entryPath);
		} catch (error) {
			if (isMissingPathError(error)) return null;
			throw error;
		}
	}
	if (!stat.isDirectory()) return null;

	try {
		const realPath = await fs.realpath(entryPath);
		return isWithin(rootRealPath, realPath) ? realPath : null;
	} catch (error) {
		if (isMissingPathError(error)) return null;
		throw error;
	}
}

/** True when any path segment is a symlink resolving outside the workspace. */
async function hasExternalSymlink(
	root: string,
	rootRealPath: string,
	candidate: string,
): Promise<boolean> {
	const relative = path.relative(root, candidate);
	const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
	let current = root;
	for (const segment of segments) {
		current = path.join(current, segment);
		try {
			if ((await fs.lstat(current)).isSymbolicLink()) {
				const realPath = await fs.realpath(current);
				if (!isWithin(rootRealPath, realPath)) return true;
			}
		} catch (error) {
			if (isMissingPathError(error)) return false;
			throw error;
		}
	}
	return false;
}

function matchesGlob(relativePath: string, glob: string): boolean {
	if (glob === "" || glob === "**" || glob === "**/*") return true;
	let source = "";
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index];
		const next = glob[index + 1];
		const afterNext = glob[index + 2];
		if (char === "*" && next === "*" && afterNext === "/") {
			source += "(?:.*/)?";
			index += 2;
		} else if (char === "*" && next === "*") {
			source += ".*";
			index += 1;
		} else if (char === "*") {
			source += "[^/]*";
		} else {
			source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
		}
	}
	return new RegExp(`^${source}$`).test(relativePath);
}

function toPosixPath(input: string): string {
	return input.split(path.sep).join("/");
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function isMissingPathError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
