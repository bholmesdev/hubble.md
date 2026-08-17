import {
	absoluteWorkspacePath,
	dirname,
	joinPath,
	normalizePath,
	pathInFolder,
	relativeWorkspacePath,
	replacePathPrefix,
} from "./filePath";

export type MovedFile = {
	fromPath: string;
	toPath: string;
};

type MarkdownFile = {
	path: string;
};

export type MovedFileIndex = Map<string, MovedFile>;

export type CopiedAsset = {
	fromPath: string;
	toPath: string;
};

/** Splits a link destination into its filesystem path and query/hash suffix. */
function splitLinkDestination(destination: string): {
	path: string;
	suffix: string;
} {
	const queryIndex = destination.indexOf("?");
	const hashIndex = destination.indexOf("#");
	const suffixIndex = [queryIndex, hashIndex]
		.filter((index) => index >= 0)
		.sort((a, b) => a - b)[0];
	if (suffixIndex === undefined) return { path: destination, suffix: "" };
	return {
		path: destination.slice(0, suffixIndex),
		suffix: destination.slice(suffixIndex),
	};
}

/** Returns true for file links whose meaning changes when their source moves. */
function isLocalRelativeDestination(destination: string): boolean {
	const { path } = splitLinkDestination(destination.trim());
	if (!path) return false;
	if (path.startsWith("/") || path.startsWith("\\") || path.startsWith("//"))
		return false;
	if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)) return false;
	return !/^[a-zA-Z]:[\\/]/.test(path);
}

/** Resolves a local link destination as it was understood from its old file. */
function absoluteLinkPath(sourceFilePath: string, destinationPath: string) {
	const sourceDir = dirname(sourceFilePath);
	if (!sourceDir) return normalizePath(destinationPath);
	return normalizePath(joinPath(sourceDir, destinationPath));
}

/** Computes the local link destination from one directory to another path. */
function relativeLinkPath(fromDir: string, toPath: string): string {
	const fromParts = normalizePath(fromDir).split("/").filter(Boolean);
	const toParts = normalizePath(toPath).split("/").filter(Boolean);
	while (
		fromParts.length > 0 &&
		toParts.length > 0 &&
		fromParts[0]?.toLocaleLowerCase() === toParts[0]?.toLocaleLowerCase()
	) {
		fromParts.shift();
		toParts.shift();
	}
	const relativeParts = [...fromParts.map(() => ".."), ...toParts];
	const relative = relativeParts.join("/");
	if (!relative) return ".";
	return relative;
}

/** Indexes moved Markdown files by their old absolute path for fast link lookup. */
export function indexMovedFiles(movedFiles: MovedFile[]): MovedFileIndex {
	return new Map(
		movedFiles.map((movedFile) => [
			normalizePath(movedFile.fromPath).toLocaleLowerCase(),
			movedFile,
		]),
	);
}

/** Builds the Markdown file moves implied by either a file move or folder move. */
export function movedMarkdownFiles(
	files: MarkdownFile[],
	sourcePath: string,
	nextPath: string,
	isFolder: boolean,
): MovedFile[] {
	if (!isFolder) return [{ fromPath: sourcePath, toPath: nextPath }];
	return files
		.filter((file) => pathInFolder(file.path, sourcePath))
		.map((file) => ({
			fromPath: file.path,
			toPath: replacePathPrefix(file.path, sourcePath, nextPath),
		}));
}

/** Returns a path's new location if it is inside one of the moved paths. */
export function pathAfterMove(path: string, movedByOldPath: MovedFileIndex) {
	const normalizedPath = normalizePath(path);
	const exactMove = movedByOldPath.get(normalizedPath.toLocaleLowerCase());
	if (exactMove) return exactMove.toPath;
	for (const movedPath of movedByOldPath.values()) {
		const fromPath = normalizePath(movedPath.fromPath);
		if (!pathInFolder(normalizedPath, fromPath)) continue;
		return replacePathPrefix(
			normalizedPath,
			fromPath,
			normalizePath(movedPath.toPath),
		);
	}
	return path;
}

/** Re-bases a link inside a moved Markdown file from the file's new directory. */
function linkDestinationForMovedSource(
	destination: string,
	fromPath: string,
	toPath: string,
	movedByOldPath: MovedFileIndex,
) {
	if (!isLocalRelativeDestination(destination)) return destination;
	const { path, suffix } = splitLinkDestination(destination);
	const linkTarget = absoluteLinkPath(fromPath, path);
	const nextTarget = pathAfterMove(linkTarget, movedByOldPath);
	const nextDir = dirname(toPath);
	if (!nextDir) return destination;
	return `${relativeLinkPath(nextDir, nextTarget)}${suffix}`;
}

/** Rewrites a link when its destination is one of the moved Markdown files. */
function linkDestinationForMovedTarget(
	destination: string,
	sourcePath: string,
	nextSourcePath: string,
	movedByOldPath: MovedFileIndex,
) {
	if (!isLocalRelativeDestination(destination)) return destination;
	const { path, suffix } = splitLinkDestination(destination);
	const linkTarget = absoluteLinkPath(sourcePath, path);
	const nextTarget = pathAfterMove(linkTarget, movedByOldPath);
	if (nextTarget === linkTarget) return destination;
	const sourceDir = dirname(nextSourcePath);
	if (!sourceDir) return destination;
	return `${relativeLinkPath(sourceDir, nextTarget)}${suffix}`;
}

/** Rewrites Markdown links, images, and HTML src/href destinations in one pass. */
function rewriteLinkDestinations(
	content: string,
	rewrite: (destination: string) => string,
): string {
	return content
		.replace(
			/(!?\[[^\]\n]*\]\()([^)\n]+)(\))/g,
			(match, open, destination, close) => {
				const trimmedDestination = destination.trim();
				// Markdown link titles belong to the link destination, but not to the
				// filesystem path we resolve for move/rename rewrites.
				const titledDestination = trimmedDestination.match(
					/^(\S+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/,
				);
				const destinationPath = titledDestination?.[1] ?? trimmedDestination;
				const title = titledDestination?.[2] ?? "";
				const nextDestination = `${rewrite(destinationPath)}${title}`;
				return nextDestination === trimmedDestination
					? match
					: `${open}${nextDestination}${close}`;
			},
		)
		.replace(
			/\b(src|href)=(["'])([^"']+)\2/gi,
			(match, attr, quote, destination) => {
				const nextDestination = rewrite(destination);
				return nextDestination === destination
					? match
					: `${attr}=${quote}${nextDestination}${quote}`;
			},
		);
}

/** Rewrites links inside files that moved, so unchanged targets still resolve. */
function rewriteLinksForMovedSource(
	content: string,
	fromPath: string,
	toPath: string,
	movedByOldPath: MovedFileIndex,
) {
	return rewriteLinkDestinations(content, (destination) =>
		linkDestinationForMovedSource(
			destination,
			fromPath,
			toPath,
			movedByOldPath,
		),
	);
}

/** Rewrites links in any file that pointed to moved Markdown files. */
function rewriteLinksToMovedTargets(
	content: string,
	sourcePath: string,
	nextSourcePath: string,
	movedByOldPath: MovedFileIndex,
) {
	return rewriteLinkDestinations(content, (destination) =>
		linkDestinationForMovedTarget(
			destination,
			sourcePath,
			nextSourcePath,
			movedByOldPath,
		),
	);
}

/** Rewrites wiki links because their destinations are workspace-relative. */
function rewriteWikiLinks(
	content: string,
	workspacePath: string,
	movedByOldPath: MovedFileIndex,
) {
	return content.replace(
		/\[\[([^\]\n|]+)(\|[^\]\n]+)?\]\]/g,
		(match, target, title = "") => {
			const fromPath = absoluteWorkspacePath(target, workspacePath);
			const movedTarget = movedByOldPath.get(
				normalizePath(fromPath).toLocaleLowerCase(),
			);
			if (!movedTarget) return match;
			return `[[${relativeWorkspacePath(movedTarget.toPath, workspacePath)}${title}]]`;
		},
	);
}

/**
 * Rewrites Markdown and wiki links after sidebar rename/move operations.
 *
 * Links are resolved from the file's old path, then written relative to its new
 * path so folder moves and file moves share one path.
 */
export function rewriteMovedLinks({
	content,
	filePath,
	nextPath,
	workspacePath,
	movedByOldPath,
}: {
	content: string;
	filePath: string;
	nextPath: string;
	workspacePath: string;
	movedByOldPath: MovedFileIndex;
}) {
	const movedSource = movedByOldPath.get(
		normalizePath(filePath).toLocaleLowerCase(),
	);
	let nextContent = rewriteLinksToMovedTargets(
		content,
		filePath,
		nextPath,
		movedByOldPath,
	);
	// Moved files also need their own relative links re-based from their new
	// directory, even when the referenced target did not move.
	if (movedSource) {
		nextContent = rewriteLinksForMovedSource(
			nextContent,
			movedSource.fromPath,
			movedSource.toPath,
			movedByOldPath,
		);
	}
	return rewriteWikiLinks(nextContent, workspacePath, movedByOldPath);
}

/**
 * Re-bases relative links when Markdown is copied to a different folder.
 *
 * Uncopied targets keep pointing to their original absolute location. Asset
 * targets supplied by the bundle copier point at their copied destination.
 * Workspace-relative wikilinks need no rewrite because copying their source
 * does not change their meaning.
 */
export function rebaseCopiedMarkdown({
	content,
	fromPath,
	toPath,
	copiedAssets = [],
}: {
	content: string;
	fromPath: string;
	toPath: string;
	copiedAssets?: CopiedAsset[];
}) {
	const targetDir = dirname(toPath);
	if (!targetDir) return content;
	const copiedBySource = new Map(
		copiedAssets.map((asset) => [
			normalizePath(asset.fromPath).toLocaleLowerCase(),
			normalizePath(asset.toPath),
		]),
	);
	return rewriteLinkDestinations(content, (destination) => {
		if (!isLocalRelativeDestination(destination)) return destination;
		const { path, suffix } = splitLinkDestination(destination);
		const originalTarget = absoluteLinkPath(fromPath, path);
		const copiedTarget =
			copiedBySource.get(originalTarget.toLocaleLowerCase()) ?? originalTarget;
		return `${relativeLinkPath(targetDir, copiedTarget)}${suffix}`;
	});
}
