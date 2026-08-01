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
	isHiddenSidebarFolderName,
	isVisibleSidebarFileName,
} from "../src/lib/filePath";

type IgnoreRule = {
	dir: string;
	matcher: ReturnType<typeof ignore>;
};

const ignoreConfigFiles = [".gitignore", ".ignore"];
const ignoredWorkspaceDirs = new Set([".git", "dist", "node_modules"]);

function toRendererPath(input: string): string {
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

/** Covers always-ignored workspace dirs in case Git ignores do not catch them. */
function isIgnoredWorkspacePath(candidatePath: string): boolean {
	return candidatePath
		.split(/[\\/]+/)
		.some((segment) => ignoredWorkspaceDirs.has(segment));
}

function toIgnorePath(input: string): string {
	return input.split(path.sep).join("/");
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
		const ignorePath = toIgnorePath(relative);
		const result = matcher.test(ignorePath);
		const directoryResult = matcher.test(`${ignorePath}/`);
		if (result.ignored || directoryResult.ignored) ignored = true;
		if (result.unignored || directoryResult.unignored) ignored = false;
	}
	return ignored;
}

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

async function collectSidebarFiles(
	dir: string,
	out: DirectoryListing,
	inheritedRules: IgnoreRule[] = [],
) {
	const rules = await rulesForDir(dir, inheritedRules);
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (isIgnoredByRules(entryPath, rules)) continue;
		if (entry.isDirectory()) {
			if (isHiddenSidebarFolderName(entry.name)) continue;
			const stat = await fs.lstat(entryPath);
			out.folders.push({
				path: toRendererPath(entryPath),
				modified_at: Math.floor(stat.mtimeMs / 1000),
			});
			await collectSidebarFiles(entryPath, out, rules);
		} else if (entry.isFile() && isVisibleSidebarFileName(entry.name)) {
			const stat = await fs.lstat(entryPath);
			out.files.push({
				path: toRendererPath(entryPath),
				modified_at: Math.floor(stat.mtimeMs / 1000),
				kind: fileKindForPath(entry.name),
			});
		}
	}
}

async function rulesForPath(root: string, dir: string) {
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

async function containsSymlink(
	root: string,
	candidate: string,
): Promise<boolean> {
	const relative = path.relative(root, candidate);
	const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
	let current = root;
	for (const segment of segments) {
		current = path.join(current, segment);
		try {
			if ((await fs.lstat(current)).isSymbolicLink()) return true;
		} catch (error) {
			if (isMissingPathError(error)) return false;
			throw error;
		}
	}
	return false;
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

async function listSidebarSubtree(
	root: string,
	target: string,
): Promise<DirectoryListing> {
	const listing: DirectoryListing = { files: [], folders: [] };
	const inheritedRules =
		target === root ? [] : await rulesForPath(root, path.dirname(target));

	if (target !== root) {
		const stat = await fs.lstat(target);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			!isVisibleSidebarPath(root, target, inheritedRules)
		) {
			return listing;
		}
		listing.folders.push({
			path: toRendererPath(target),
			modified_at: Math.floor(stat.mtimeMs / 1000),
		});
	}

	await collectSidebarFiles(target, listing, inheritedRules);
	return listing;
}

async function fileDelta(
	root: string,
	filePath: string,
): Promise<WorkspaceDelta> {
	const name = path.basename(filePath);
	if (!isVisibleSidebarFileName(name)) {
		return { kind: "remove", path: toRendererPath(filePath) };
	}
	const rules = await rulesForPath(root, path.dirname(filePath));
	if (!isVisibleSidebarPath(root, filePath, rules)) {
		return { kind: "remove", path: toRendererPath(filePath) };
	}
	const stat = await fs.lstat(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		return { kind: "remove", path: toRendererPath(filePath) };
	}
	const entry: FileEntry = {
		path: toRendererPath(filePath),
		modified_at: Math.floor(stat.mtimeMs / 1000),
		kind: fileKindForPath(name),
	};
	return { kind: "file", entry };
}

export async function listSidebarFiles(
	root: string,
): Promise<DirectoryListing> {
	const listing: DirectoryListing = { files: [], folders: [] };
	await collectSidebarFiles(root, listing);
	return listing;
}

export async function reconcileSidebarPath(
	root: string,
	changedPath: string,
): Promise<WorkspaceDelta> {
	const resolvedRoot = path.resolve(root);
	const resolvedPath = path.resolve(changedPath);
	if (!isWithin(resolvedRoot, resolvedPath)) return { kind: "refresh" };
	if (resolvedPath === resolvedRoot) return { kind: "refresh" };

	if (ignoreConfigFiles.includes(path.basename(resolvedPath))) {
		const target = path.dirname(resolvedPath);
		if (await containsSymlink(resolvedRoot, target)) {
			return { kind: "remove", path: toRendererPath(resolvedPath) };
		}
		const listing = await listSidebarSubtree(resolvedRoot, target);
		return {
			kind: "subtree",
			path: toRendererPath(target),
			listing,
		};
	}

	let stat: Awaited<ReturnType<typeof fs.lstat>>;
	try {
		stat = await fs.lstat(resolvedPath);
	} catch (error) {
		if (isMissingPathError(error)) {
			return { kind: "remove", path: toRendererPath(resolvedPath) };
		}
		return { kind: "refresh" };
	}

	if (stat.isSymbolicLink()) {
		return { kind: "remove", path: toRendererPath(resolvedPath) };
	}
	if (await containsSymlink(resolvedRoot, resolvedPath)) {
		return { kind: "remove", path: toRendererPath(resolvedPath) };
	}
	if (stat.isDirectory()) {
		const listing = await listSidebarSubtree(resolvedRoot, resolvedPath);
		return {
			kind: "subtree",
			path: toRendererPath(resolvedPath),
			listing,
		};
	}
	if (stat.isFile()) return fileDelta(resolvedRoot, resolvedPath);
	return { kind: "remove", path: toRendererPath(resolvedPath) };
}

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
		if (relativePath === ".hubble" || relativePath.startsWith(".hubble/"))
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
