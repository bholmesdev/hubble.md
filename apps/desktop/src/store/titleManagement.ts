import { toast } from "sonner";
import { desktopApi } from "../desktopApi";
import { dirname, extname, joinPath, pathEquals } from "../lib/filePath";
import {
	indexMovedFiles,
	type MovedFile,
	rewriteMovedLinks,
} from "../lib/markdownLinkRewrite";
import { generatedTitleStem } from "../lib/titleGeneration";
import { rewriteHistory } from "./history";
import {
	appStore,
	type FileEntry,
	titleGenerationPreviewStore,
	viewerStore,
	workspaceStore,
} from "./state";

const TITLE_RENAME_DELAY_MS = 500;
const existingPathErrorPattern = /\bEEXIST\b|\balready exists\b/i;

type TitleSession = {
	path: string;
	documentId: string;
	markdown: string;
	pendingTitle?: { markdown: string; path: Promise<string | null> };
	timer?: number;
	running: boolean;
};

type SaveOptions = { force?: boolean; throwOnError?: boolean };

type TitleManagerDeps = {
	pendingRenames: Map<string, string>;
	runFileTask: (path: string, task: () => Promise<void>) => Promise<void>;
	savePathContent: (
		path: string,
		content: string,
		options?: SaveOptions,
	) => Promise<void>;
	moveAssociatedAssetFolder: (
		fromFilePath: string,
		toFilePath: string,
	) => Promise<MovedFile | null>;
	updateMovedLinks: (
		movedFiles: MovedFile[],
		files: FileEntry[],
	) => Promise<void>;
	syncPinnedNotes: () => Promise<void>;
	errorMessage: (err: unknown) => string;
	handleFileError: (err: unknown) => string;
};

export function createTitleManager(deps: TitleManagerDeps) {
	const sessions = new Map<string, TitleSession>();

	function start(path: string) {
		sessions.set(path, {
			path,
			documentId: path,
			markdown: "",
			running: false,
		});
	}

	function stop(path: string) {
		const session = sessions.get(path);
		if (!session) return;
		if (session.timer !== undefined) window.clearTimeout(session.timer);
		for (const [sessionPath, candidate] of sessions) {
			if (candidate === session) sessions.delete(sessionPath);
		}
		const preview = titleGenerationPreviewStore.get();
		if (preview?.path === session.path) titleGenerationPreviewStore.set(null);
	}

	function currentPath(path: string) {
		return sessions.get(path)?.path ?? path;
	}

	function editorDocumentId(path: string) {
		return sessions.get(path)?.documentId ?? path;
	}

	function update(path: string, markdown: string) {
		const session = sessions.get(path);
		if (session) schedule(session, markdown);
	}

	function schedule(session: TitleSession, markdown: string) {
		session.markdown = markdown;
		const stem = generatedTitleStem(markdown);
		const previewPath = stem
			? joinPath(dirname(session.path) ?? "", `${stem}${extname(session.path)}`)
			: null;
		titleGenerationPreviewStore.set(
			previewPath ? { path: session.path, previewPath } : null,
		);
		const pendingTitle = {
			markdown,
			path: generatedTitlePath(session.path, markdown),
		};
		session.pendingTitle = pendingTitle;
		void pendingTitle.path.then((previewPath) => {
			if (
				session.pendingTitle !== pendingTitle ||
				sessions.get(session.path) !== session
			) {
				return;
			}
			titleGenerationPreviewStore.set(
				previewPath ? { path: session.path, previewPath } : null,
			);
		});
		if (session.timer !== undefined) window.clearTimeout(session.timer);
		session.timer = window.setTimeout(() => {
			session.timer = undefined;
			void run(session);
		}, TITLE_RENAME_DELAY_MS);
	}

	async function generatedTitlePath(path: string, markdown: string) {
		const stem = generatedTitleStem(markdown);
		if (!stem) return null;
		const parent = dirname(path) ?? "";
		const extension = extname(path);
		for (let index = 1; ; index++) {
			const name = index === 1 ? stem : `${stem}-${index}`;
			const candidate = joinPath(parent, `${name}${extension}`);
			if (pathEquals(candidate, path)) return path;
			if (!(await desktopApi.pathExists(candidate))) return candidate;
		}
	}

	async function run(session: TitleSession) {
		if (session.running || sessions.get(session.path) !== session) return;
		if (viewerStore.get().currentPath !== session.path) {
			stop(session.path);
			return;
		}
		const markdown = session.markdown;
		const previousPath = session.path;
		const nextPath =
			session.pendingTitle?.markdown === markdown
				? await session.pendingTitle.path
				: await generatedTitlePath(previousPath, markdown);
		if (!isLive(session)) return;
		if (!nextPath || pathEquals(nextPath, previousPath)) return;

		session.running = true;
		try {
			await renameGeneratedFile(session, previousPath, nextPath);
		} finally {
			session.running = false;
		}
		if (isLive(session) && session.markdown !== markdown) {
			schedule(session, session.markdown);
		}
	}

	async function renameGeneratedFile(
		session: TitleSession,
		previousPath: string,
		nextPath: string,
	) {
		const { files: filesBeforeRename, workspacePath } = workspaceStore.get();
		let renamed = false;
		let renamedPath = nextPath;
		await deps.runFileTask(previousPath, async () => {
			if (
				sessions.get(previousPath) !== session ||
				viewerStore.get().currentPath !== previousPath
			) {
				return;
			}
			try {
				const retryPath = await renameGeneratedFileWithRetry(
					previousPath,
					nextPath,
					session.markdown,
					() =>
						sessions.get(previousPath) === session &&
						viewerStore.get().currentPath === previousPath,
				);
				if (!retryPath) return;
				renamedPath = retryPath;
				const movedFiles = [{ fromPath: previousPath, toPath: renamedPath }];
				publishRename(session, previousPath, renamedPath);
				if (!isLive(session)) stop(renamedPath);
				renamed = true;
				const movedAssetFolder = await deps.moveAssociatedAssetFolder(
					previousPath,
					renamedPath,
				);
				if (movedAssetFolder) movedFiles.push(movedAssetFolder);
				if (workspacePath) {
					session.markdown = rewriteMovedLinks({
						content: session.markdown,
						filePath: previousPath,
						nextPath: renamedPath,
						workspacePath,
						movedByOldPath: indexMovedFiles(movedFiles),
					});
				}

				updateContentIfLive(session, session.markdown);
				await deps.updateMovedLinks(movedFiles, filesBeforeRename);
				if (workspaceStore.get().pinnedNotes.includes(renamedPath)) {
					void deps.syncPinnedNotes();
				}
			} catch (err) {
				const message = deps.handleFileError(err);
				toast.error("Failed to rename file", { description: message });
			} finally {
				window.setTimeout(() => deps.pendingRenames.delete(previousPath), 1000);
			}
		});

		if (!renamed) return;
		// Flush link rewrites at the path that won, including retry suffixes.
		if (isLive(session)) {
			await deps.savePathContent(renamedPath, session.markdown, {
				force: true,
			});
		}
	}

	async function renameGeneratedFileWithRetry(
		previousPath: string,
		initialNextPath: string,
		markdown: string,
		isLiveSession: () => boolean,
	) {
		let nextPath = initialNextPath;
		for (let attempt = 0; ; attempt++) {
			if (!isLiveSession()) return null;
			try {
				deps.pendingRenames.set(previousPath, nextPath);
				await desktopApi.renameFile(previousPath, nextPath);
				return nextPath;
			} catch (err) {
				if (
					attempt >= 4 ||
					!existingPathErrorPattern.test(deps.errorMessage(err))
				) {
					throw err;
				}
				const retryPath = await generatedTitlePath(previousPath, markdown);
				if (!isLiveSession()) return null;
				if (
					!retryPath ||
					pathEquals(retryPath, previousPath) ||
					pathEquals(retryPath, nextPath)
				) {
					throw err;
				}
				nextPath = retryPath;
			}
		}
	}

	function publishRename(
		session: TitleSession,
		previousPath: string,
		nextPath: string,
	) {
		// Keep the prior path for events from the pre-rename render, but drop
		// older aliases so the session stays bounded.
		for (const [sessionPath, candidate] of sessions) {
			if (candidate === session && sessionPath !== previousPath) {
				sessions.delete(sessionPath);
			}
		}
		session.path = nextPath;
		sessions.set(nextPath, session);
		titleGenerationPreviewStore.set({
			path: nextPath,
			previewPath: nextPath,
		});
		rewriteHistory(previousPath, nextPath);
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.map((file) =>
					pathEquals(file.path, previousPath)
						? { ...file, path: nextPath }
						: file,
				),
				pinnedNotes: state.workspace.pinnedNotes.map((path) =>
					pathEquals(path, previousPath) ? nextPath : path,
				),
				lastOpenedPaths: Object.fromEntries(
					Object.entries(state.workspace.lastOpenedPaths).map(
						([workspacePath, openedPath]) => [
							workspacePath,
							pathEquals(openedPath, previousPath) ? nextPath : openedPath,
						],
					),
				),
			},
			document: {
				...state.document,
				currentPath: pathEquals(state.document.currentPath ?? "", previousPath)
					? nextPath
					: state.document.currentPath,
				lastOpenedPath: pathEquals(
					state.document.lastOpenedPath ?? "",
					previousPath,
				)
					? nextPath
					: state.document.lastOpenedPath,
			},
		}));
	}

	function isLive(session: TitleSession) {
		return (
			sessions.get(session.path) === session &&
			viewerStore.get().currentPath === session.path
		);
	}

	function updateContentIfLive(session: TitleSession, content: string) {
		appStore.set((state) => {
			if (
				state.document.currentPath !== session.path ||
				sessions.get(session.path) !== session
			) {
				return state;
			}
			return {
				...state,
				document: {
					...state.document,
					content,
				},
			};
		});
	}

	return { currentPath, editorDocumentId, start, stop, update };
}
