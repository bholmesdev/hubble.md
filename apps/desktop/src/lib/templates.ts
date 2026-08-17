import {
	dirname,
	hasMarkdownExtension,
	joinPath,
	normalizePath,
	pathEquals,
} from "./filePath";

export const TEMPLATE_LIBRARY_NAME = "templates";

export type TemplateFileEntry = {
	path: string;
	kind?: string;
};

export type TemplateChoice = {
	path: string;
	libraryPath: string;
	libraryRelativePath: string;
	label: string;
	ownerPath: string | null;
	libraryRank: number;
};

function normalizedLower(path: string) {
	return normalizePath(path).toLocaleLowerCase();
}

function splitPath(path: string) {
	const normalized = normalizePath(path);
	return {
		absolute: normalized.startsWith("/"),
		parts: normalized.split("/").filter(Boolean),
	};
}

function pathFromParts(parts: string[], absolute: boolean) {
	if (parts.length === 0) return absolute ? "/" : "";
	return `${absolute ? "/" : ""}${parts.join("/")}`;
}

function stripMarkdownExtension(path: string) {
	return path.replace(/\.(md|markdown|mdown)$/i, "");
}

function relativePathInFolder(path: string, folderPath: string) {
	const normalizedPath = normalizePath(path);
	const normalizedFolder = normalizePath(folderPath).replace(/\/+$/, "");
	if (pathEquals(normalizedPath, normalizedFolder)) return "";
	const prefix = `${normalizedFolder}/`;
	const lowerPath = normalizedPath.toLocaleLowerCase();
	const lowerPrefix = prefix.toLocaleLowerCase();
	return lowerPath.startsWith(lowerPrefix)
		? normalizedPath.slice(prefix.length)
		: null;
}

function compareLibraryRelativePath(a: TemplateChoice, b: TemplateChoice) {
	const lowerA = a.libraryRelativePath.toLocaleLowerCase();
	const lowerB = b.libraryRelativePath.toLocaleLowerCase();
	const byInsensitive = lowerA.localeCompare(lowerB);
	if (byInsensitive !== 0) return byInsensitive;
	if (a.libraryRelativePath === b.libraryRelativePath) return 0;
	return a.libraryRelativePath < b.libraryRelativePath ? -1 : 1;
}

export function isTemplateLibraryName(name: string) {
	return name.toLocaleLowerCase() === TEMPLATE_LIBRARY_NAME;
}

export function owningTemplateLibraryPath(path: string) {
	const { parts, absolute } = splitPath(path);
	let libraryIndex = -1;
	for (let index = 0; index < parts.length; index += 1) {
		if (isTemplateLibraryName(parts[index])) libraryIndex = index;
	}
	if (libraryIndex === -1) return null;
	return pathFromParts(parts.slice(0, libraryIndex + 1), absolute);
}

export function isTemplatePath(path: string) {
	return hasMarkdownExtension(path) && owningTemplateLibraryPath(path) !== null;
}

export function templateOwnerFolderPath(path: string) {
	const libraryPath = owningTemplateLibraryPath(path);
	return dirname(libraryPath ?? path);
}

export function cascadingTemplateLibraryPaths(
	ownerPath: string | null,
	workspacePath: string | null,
) {
	if (!ownerPath || !workspacePath) return [];

	const root = normalizePath(workspacePath);
	const libraries: string[] = [];
	let current: string | null = normalizePath(ownerPath);
	while (current) {
		const lowerCurrent = normalizedLower(current);
		const lowerRoot = normalizedLower(root);
		if (
			lowerCurrent === lowerRoot ||
			lowerCurrent.startsWith(`${lowerRoot}/`)
		) {
			libraries.push(joinPath(current, TEMPLATE_LIBRARY_NAME));
		}
		if (pathEquals(current, root)) break;
		const parent = dirname(current);
		if (!parent || pathEquals(parent, current)) break;
		current = parent;
	}
	return libraries;
}

export function discoverTemplateChoices({
	files,
	targetPath,
	workspacePath,
	currentPath = targetPath,
}: {
	files: readonly TemplateFileEntry[];
	targetPath: string;
	workspacePath: string | null;
	currentPath?: string | null;
}) {
	const ownerPath = templateOwnerFolderPath(targetPath);
	const libraries = cascadingTemplateLibraryPaths(ownerPath, workspacePath);
	const libraryRank = new Map(
		libraries.map((path, index) => [normalizedLower(path), index]),
	);
	const choices: TemplateChoice[] = [];

	for (const file of files) {
		if (currentPath && pathEquals(file.path, currentPath)) continue;
		if (file.kind && file.kind !== "document") continue;
		if (!hasMarkdownExtension(file.path)) continue;

		const libraryPath = owningTemplateLibraryPath(file.path);
		if (!libraryPath) continue;
		const rank = libraryRank.get(normalizedLower(libraryPath));
		if (rank === undefined) continue;

		const libraryRelativePath = relativePathInFolder(file.path, libraryPath);
		if (!libraryRelativePath) continue;
		choices.push({
			path: file.path,
			libraryPath,
			libraryRelativePath,
			label: stripMarkdownExtension(libraryRelativePath),
			ownerPath: dirname(libraryPath),
			libraryRank: rank,
		});
	}

	return choices.sort((a, b) => {
		const byLibrary =
			(libraryRank.get(normalizedLower(a.libraryPath)) ?? 0) -
			(libraryRank.get(normalizedLower(b.libraryPath)) ?? 0);
		return byLibrary || compareLibraryRelativePath(a, b);
	});
}

export function resolveDefaultTemplateChoice(
	validDefaultChoices: readonly TemplateChoice[],
) {
	return [...validDefaultChoices].sort((a, b) => {
		const byLibrary = a.libraryRank - b.libraryRank;
		return byLibrary || compareLibraryRelativePath(a, b);
	})[0];
}
