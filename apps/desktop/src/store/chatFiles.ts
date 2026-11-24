import { desktopApi } from "../desktopApi";
import type { ChatFileReply, ChatFileRequest } from "../desktopApi/chat";
import { savePathContent, updateEditorContent } from "./actions";
import { viewerStore, workspacePathStore } from "./state";

/** Keep tool edits on the same save queue and conflict checks as editor edits. */
export async function handleChatFileRequest(
	request: ChatFileRequest,
	isActive: () => boolean,
): Promise<ChatFileReply> {
	const reply = {
		requestId: request.requestId,
		callId: request.callId,
		open: false,
	};
	const guard = () => {
		if (!isActive() || workspacePathStore.get() !== request.workspacePath)
			throw new Error("Chat workspace changed or request stopped.");
	};
	try {
		guard();
		const doc = viewerStore.get();
		if (doc.currentPath !== request.path) return reply;
		if (doc.status !== "ready" || doc.externalChange.kind === "conflict")
			throw new Error(
				"Resolve the open file's load error or external change before editing.",
			);
		if (request.operation === "read")
			return {
				...reply,
				open: true,
				text: doc.content,
				diskContent: doc.diskContent,
			};
		if (request.before !== doc.content || request.after === undefined)
			throw new Error("Editor changed. Read the file again before editing.");
		const after = request.after;
		await savePathContent(request.path, after, {
			throwOnError: true,
			beforeWrite: () => {
				guard();
				const current = viewerStore.get();
				if (
					current.currentPath !== request.path ||
					current.content !== request.before
				)
					throw new Error("Editor changed before the edit could be saved.");
				updateEditorContent(request.path, after, { undoable: true });
			},
		});
		if ((await desktopApi.readFileText(request.path)) !== request.after)
			throw new Error(
				"Edit was not saved. Read the file again before retrying.",
			);
		return { ...reply, open: true };
	} catch (error) {
		return {
			...reply,
			error:
				error instanceof Error ? error.message : "Editor operation failed.",
		};
	}
}
