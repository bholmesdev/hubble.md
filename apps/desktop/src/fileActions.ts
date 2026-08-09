import {
	createHtmlFileInFolder,
	createMarkdownFileInFolder,
} from "./store/actions";
import { workspaceStore } from "./store/state";

export async function createMarkdownFile(parentPath?: string | null) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	await createMarkdownFileInFolder(targetPath);
}

export async function createHtmlFile(parentPath?: string | null) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	await createHtmlFileInFolder(targetPath);
}
