import { getActiveEditor } from "@hubble.md/ui";
import {
	createHtmlFileInFolder,
	createMarkdownFileInFolder,
} from "./store/actions";
import { viewerStore, workspaceStore } from "./store/state";

export async function createMarkdownFile(parentPath?: string | null) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	const path = await createMarkdownFileInFolder(targetPath);
	if (!path) return;
	focusMarkdownEditorAfterRender(path);
}

export function focusMarkdownEditorAfterRender(path: string) {
	requestAnimationFrame(() => {
		if (viewerStore.get().currentPath !== path) return;
		getActiveEditor()?.commands.focus("end");
	});
}

export async function createHtmlFile(parentPath?: string | null) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	await createHtmlFileInFolder(targetPath);
}
