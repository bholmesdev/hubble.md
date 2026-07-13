import { createConvexSubscriber } from "@hubble.md/convex-client";
import { withMarkdownExtension } from "@hubble.md/editor";
import { AppShellFrame } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { useEffect, useRef, useState } from "react";
import { saveWorkspace } from "../connection/connection";
import {
	applyRemoteChange,
	clearCurrentPath,
	getActionCtx,
	loadPath,
	loadWorkspaceSnapshot,
	markRemoteDeleted,
	refreshAssets,
	refreshFiles,
	reloadFromRemote,
	savePathContent,
	teardownActions,
} from "../store/actions";
import { viewerStore, workspaceStore } from "../store/state";
import { EditorView } from "./EditorView";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";

type Props = {
	url: string;
	workspaceId: string;
	filePath: string | null;
	onSelectFile: (path: string) => void;
	onSwitch: (id: string) => void;
	onWorkspaceLoaded: (workspaceId: string) => void;
	onDisconnect: () => void;
};

async function onRemoteFilesChanged() {
	const ctx = getActionCtx();
	if (!ctx) return;
	const remote = await ctx.backend.getFiles(ctx.workspaceId, {
		includeDeleted: true,
	});
	// One tombstone-inclusive fetch updates the sidebar and detects whether
	// the current file was deleted.
	const visible = remote
		.filter((file) => !file.deleted)
		.map((file) => ({
			path: file.path,
			contentHash: file.contentHash,
			updatedAt: file.updatedAt,
			deleted: file.deleted,
		}));
	workspaceStore.set((state) => ({ ...state, files: visible }));

	const viewer = viewerStore.get();
	if (!viewer.currentPath) return;
	const current = remote.find((file) => file.path === viewer.currentPath);
	if (!current || current.deleted) {
		markRemoteDeleted(viewer.currentPath);
		return;
	}
	applyRemoteChange(viewer.currentPath, current.content, current.contentHash);
}

export function AppShell({
	url,
	workspaceId,
	filePath,
	onSelectFile,
	onSwitch,
	onWorkspaceLoaded,
	onDisconnect,
}: Props) {
	const viewer = useStoreValue(viewerStore);
	const workspace = useStoreValue(workspaceStore);
	const [newNoteName, setNewNoteName] = useState<string | null>(null);
	const [newNoteSubmitted, setNewNoteSubmitted] = useState(false);
	const newNoteInputRef = useRef<HTMLInputElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: snapshot reloads only when workspace identity changes; file route changes load below
	useEffect(() => {
		void loadWorkspaceSnapshot(url, workspaceId, filePath).then((loaded) => {
			if (!loaded) return;
			saveWorkspace(workspaceId);
			onWorkspaceLoaded(workspaceId);
		});
	}, [url, workspaceId]);

	useEffect(() => {
		if (workspace.snapshot?.id !== workspaceId) return;
		if (filePath) {
			if (viewerStore.get().currentPath !== filePath) void loadPath(filePath);
			return;
		}
		clearCurrentPath();
	}, [filePath, workspace.snapshot?.id, workspaceId]);

	useEffect(() => {
		return () => {
			teardownActions();
		};
	}, []);

	useEffect(() => {
		if (!workspace.snapshot) return;
		const subscriber = createConvexSubscriber(url);
		const unsubscribe = subscriber.onFilesChanged(
			workspace.snapshot.id,
			() => {
				void onRemoteFilesChanged();
			},
			(err) => {
				console.error("subscription error:", err);
			},
		);
		const unsubscribeAssets = subscriber.onAssetsChanged(
			workspace.snapshot.id,
			() => {
				void refreshAssets();
			},
			(err) => {
				console.error("asset subscription error:", err);
			},
		);
		return () => {
			unsubscribe();
			unsubscribeAssets();
			void subscriber.close();
		};
	}, [url, workspace.snapshot]);

	useEffect(() => {
		if (newNoteName !== null) {
			requestAnimationFrame(() => newNoteInputRef.current?.focus());
		}
	}, [newNoteName]);

	const newNotePath = normalizeNotePath(newNoteName ?? "");
	const newNoteConflict = workspace.files.some(
		(file) => file.path === newNotePath,
	);
	const showNewNoteConflict = newNoteSubmitted && newNoteConflict;

	const handleNewNote = () => {
		setNewNoteName("");
		setNewNoteSubmitted(false);
	};

	const submitNewNote = async (event: React.FormEvent) => {
		event.preventDefault();
		setNewNoteSubmitted(true);
		const name = (newNoteName ?? "").trim();
		if (!name) return;
		const path = normalizeNotePath(name);
		if (workspace.files.some((file) => file.path === path)) return;
		await savePathContent(path, "");
		setNewNoteName(null);
		setNewNoteSubmitted(false);
		await refreshFiles();
		onSelectFile(path);
	};

	if (!workspace.snapshot) {
		return (
			<main className="flex h-dvh items-center justify-center bg-background text-foreground">
				<p className="text-sm text-muted-foreground">
					{workspace.status === "error"
						? (workspace.error ?? "Workspace failed to load")
						: "Loading workspace…"}
				</p>
			</main>
		);
	}

	return (
		<AppShellFrame
			sidebar={
				<Sidebar
					url={url}
					workspaceId={workspace.snapshot.id}
					workspaceName={workspace.snapshot.name}
					onSelectFile={onSelectFile}
					onSwitch={onSwitch}
					onDisconnect={onDisconnect}
				/>
			}
			toolbar={<Toolbar onNewNote={handleNewNote} />}
		>
			{workspace.status === "error" && workspace.error && (
				<ExternalChangeBanner
					message={workspace.error}
					onReload={() => {
						void loadWorkspaceSnapshot(url, workspaceId, filePath);
					}}
				/>
			)}
			{newNoteName !== null && (
				<form
					onSubmit={submitNewNote}
					className="border-b border-border bg-muted/40 px-3 py-2"
				>
					<div className="mx-auto flex max-w-3xl items-center gap-2">
						<input
							ref={newNoteInputRef}
							type="text"
							required
							value={newNoteName}
							onChange={(e) => setNewNoteName(e.target.value)}
							placeholder="note-name.md"
							aria-invalid={showNewNoteConflict}
							aria-describedby={
								showNewNoteConflict ? "new-note-conflict" : undefined
							}
							className="flex-1 rounded-sm border border-border bg-background px-2 py-1 text-sm outline-none focus:border-ring"
						/>
						<button
							type="submit"
							className="rounded-sm bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
						>
							Create
						</button>
						<button
							type="button"
							onClick={() => setNewNoteName(null)}
							className="rounded-sm px-3 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent"
						>
							Cancel
						</button>
					</div>
					{showNewNoteConflict && (
						<p
							id="new-note-conflict"
							className="mx-auto mt-2 max-w-3xl text-sm text-destructive"
						>
							A file named {newNotePath} already exists.
						</p>
					)}
				</form>
			)}
			{viewer.currentPath && (
				<div className="flex h-full min-h-0 flex-col">
					{viewer.externalChange.kind === "conflict" && (
						<ExternalChangeBanner
							message="Remote changes available. Reload to accept."
							onReload={reloadFromRemote}
						/>
					)}
					{viewer.externalChange.kind === "deleted" && (
						<ExternalChangeBanner
							message="This file was deleted remotely. Reload before editing."
							onReload={() => {
								if (viewer.currentPath) void loadPath(viewer.currentPath);
							}}
						/>
					)}
					<EditorView
						path={viewer.currentPath}
						initialMarkdown={viewer.content}
					/>
				</div>
			)}
			{!viewer.currentPath && viewer.status === "loading" && (
				<p className="p-6 text-sm text-muted-foreground">Loading…</p>
			)}
			{!viewer.currentPath && viewer.status === "error" && (
				<p className="p-6 text-sm text-destructive">{viewer.error}</p>
			)}
			{!viewer.currentPath &&
				viewer.status !== "loading" &&
				viewer.status !== "error" &&
				workspace.filesLoaded && (
					<div className="flex h-full items-center justify-center p-6">
						<p className="text-sm text-muted-foreground">
							Select a file, or create a new one with +.
						</p>
					</div>
				)}
		</AppShellFrame>
	);
}

function normalizeNotePath(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return "";
	return withMarkdownExtension(trimmed);
}

function ExternalChangeBanner({
	message,
	onReload,
}: {
	message: string;
	onReload: () => void;
}) {
	return (
		<div className="border-b border-border bg-muted/40">
			<div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
				<p className="m-0 text-sm text-muted-foreground">{message}</p>
				<button
					type="button"
					onClick={onReload}
					className="rounded-sm border border-border bg-background px-3 py-1 text-xs hover:bg-sidebar-accent"
				>
					Reload
				</button>
			</div>
		</div>
	);
}
