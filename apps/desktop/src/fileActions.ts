import {
	createHtmlFileInFolder,
	createMarkdownFileInFolder,
} from "./store/actions";
import { workspaceStore } from "./store/state";

export async function createMarkdownFile(folderPath?: string | null) {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath) return;
	await createMarkdownFileInFolder(folderPath ?? workspacePath);
}

export async function createHtmlFile(folderPath?: string | null) {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath) return;
	await createHtmlFileInFolder(folderPath ?? workspacePath);
}
