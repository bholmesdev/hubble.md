import {
	createHtmlFileInFolder,
	createMarkdownFileInFolder,
} from "./store/actions";
import { workspaceStore } from "./store/state";
import type { TabTarget } from "./store/tabs";

export async function createMarkdownFile(
	parentPath?: string | null,
	tab?: TabTarget,
) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	await createMarkdownFileInFolder(targetPath, tab);
}

export async function createHtmlFile(parentPath?: string | null) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	await createHtmlFileInFolder(targetPath);
}
