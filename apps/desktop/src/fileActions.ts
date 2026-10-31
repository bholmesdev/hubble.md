import { getActiveEditor } from "@hubble.md/ui";
import {
	createDiagramFileInFolder,
	createHtmlFileInFolder,
	createMarkdownFileInFolder,
} from "./store/actions";
import {
	titleRenameRequestStore,
	viewerStore,
	workspaceStore,
} from "./store/state";
import type { TabTarget } from "./store/tabs";

export async function createMarkdownFile(
	parentPath?: string | null,
	tab?: TabTarget,
) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	const path = await createMarkdownFileInFolder(targetPath, tab);
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
	const path = await createHtmlFileInFolder(targetPath);
	if (path) titleRenameRequestStore.set(path);
}

export async function createDiagramFile(parentPath?: string | null) {
	const targetPath = parentPath ?? workspaceStore.get().workspacePath;
	if (!targetPath) return;
	const path = await createDiagramFileInFolder(targetPath);
	if (path) titleRenameRequestStore.set(path);
}
