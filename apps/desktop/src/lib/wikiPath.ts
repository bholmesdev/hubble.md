import {
	stripMarkdownExtension,
	withMarkdownExtension,
} from "@hubble.md/editor";
import type { FileEntry } from "../store/state";
import { joinPath, relativeWorkspacePath } from "./filePath";

export function resolveWikiPath({
	target,
	files,
	workspacePath,
}: {
	target: string;
	files: FileEntry[];
	workspacePath: string | null;
}) {
	const path = target.split("#")[0];
	const pathWithExtension = withMarkdownExtension(path);
	if (pathWithExtension.startsWith("/")) return pathWithExtension;
	const directPath = workspacePath ? joinPath(workspacePath, path) : path;
	const directMatch = files.find((file) => file.path === directPath);
	if (directMatch) return directMatch.path;

	const exactPath = workspacePath
		? joinPath(workspacePath, pathWithExtension)
		: pathWithExtension;
	const exactMatch = files.find((file) => file.path === exactPath);
	if (exactMatch) return exactMatch.path;

	const targetStem = stripMarkdownExtension(path);
	const stemMatch = files.find((file) => {
		const relativePath = relativeWorkspacePath(file.path, workspacePath);
		const relativeStem = stripMarkdownExtension(relativePath);
		const fileStem = relativeStem.split(/[\\/]/).pop() ?? relativeStem;
		return relativeStem === targetStem || fileStem === targetStem;
	});
	return stemMatch?.path ?? exactPath;
}
