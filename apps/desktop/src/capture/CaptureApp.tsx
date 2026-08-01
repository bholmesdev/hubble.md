import { EditorView } from "@hubble.md/ui";
import { useCallback, useEffect, useState } from "react";
import MingcuteArrowLeftUp from "~icons/mingcute/arrow-left-up-line";
import MingcuteArrowRightDown from "~icons/mingcute/arrow-right-down-line";
import MingcuteCheck from "~icons/mingcute/check-circle-line";
import MingcuteClose from "~icons/mingcute/close-line";
import { desktopApi } from "../desktopApi";
import type { CaptureSessionState, CaptureSettings } from "../desktopApi/types";

/** EditorView keys its state by path; the notepad is not a real file. */
const DRAFT_PATH = "capture://draft";

/** Two Escape taps inside this window collapse the panel into the pill. */
const DOUBLE_ESCAPE_MS = 500;

const dragRegion = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

function basename(path: string) {
	const segments = path.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

export function CaptureApp() {
	const [settings, setSettings] = useState<CaptureSettings | null>(null);
	const [session, setSession] = useState<CaptureSessionState>({
		phase: "idle",
	});
	const [draft, setDraft] = useState<string | null>(null);
	const [hasNotes, setHasNotes] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const [confirmingClose, setConfirmingClose] = useState(false);
	// Remounts the editor after a save so it picks up the cleared draft.
	const [draftGeneration, setDraftGeneration] = useState(0);

	// The main process owns the draft; edits made before a collapse or on
	// another route only reach this window through a reload.
	const reloadDraft = useCallback(() => {
		void desktopApi.captureGetDraft().then((markdown) => {
			setDraft(markdown);
			setHasNotes(markdown.trim().length > 0);
			setDraftGeneration((generation) => generation + 1);
		});
	}, []);

	useEffect(() => {
		void desktopApi.captureGetState().then((state) => {
			setSettings(state.settings);
			setSession(state.session);
			setCollapsed(state.collapsed);
		});
		reloadDraft();
		return desktopApi.onCaptureSessionState(setSession);
	}, [reloadDraft]);

	useEffect(
		() =>
			desktopApi.onCaptureCollapsedChanged((next) => {
				setCollapsed(next);
				if (!next) reloadDraft();
			}),
		[reloadDraft],
	);

	// A saved capture consumed the draft, so reset the notepad and step away.
	useEffect(() => {
		if (session.phase !== "saved") return;
		setDraft("");
		setHasNotes(false);
		setDraftGeneration((generation) => generation + 1);
		const timer = setTimeout(() => void desktopApi.captureHideWindow(), 1600);
		return () => clearTimeout(timer);
	}, [session]);

	// Reload the draft each time the panel reappears; it may have been saved
	// from a different route since this window last rendered.
	useEffect(() =>
		desktopApi.onCaptureWindowShown(() => {
			setConfirmingClose(false);
			reloadDraft();
		}),
	);

	const requestClose = useCallback(() => {
		if (!hasNotes) {
			void desktopApi.captureHideWindow();
			return;
		}
		// The prompt lives in the expanded layout, so a collapsed pill grows back.
		void desktopApi.captureSetCollapsed(false);
		setConfirmingClose(true);
	}, [hasNotes]);

	useEffect(
		() => desktopApi.onCaptureCloseRequested(requestClose),
		[requestClose],
	);

	// Capture phase, because editor popovers legitimately consume single Escape
	// presses; a quick double tap collapses the panel no matter who ate them.
	useEffect(() => {
		let lastEscapeAt = 0;
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
				event.preventDefault();
				requestClose();
				return;
			}
			if (event.key !== "Escape" || event.repeat) return;
			if (confirmingClose) {
				setConfirmingClose(false);
				return;
			}
			const now = Date.now();
			if (now - lastEscapeAt <= DOUBLE_ESCAPE_MS) {
				lastEscapeAt = 0;
				void desktopApi.captureSetCollapsed(true);
				return;
			}
			lastEscapeAt = now;
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [confirmingClose, requestClose]);

	const onDraftChange = useCallback((_path: string, markdown: string) => {
		setHasNotes(markdown.trim().length > 0);
		void desktopApi.captureSetDraft(markdown);
	}, []);

	const trashAndClose = () => {
		setConfirmingClose(false);
		void desktopApi.captureDiscardDraft().then(() => {
			setDraft("");
			setHasNotes(false);
			setDraftGeneration((generation) => generation + 1);
			void desktopApi.captureHideWindow();
		});
	};

	const saveAndClose = () => {
		setConfirmingClose(false);
		void desktopApi.captureSaveNotes();
	};

	const workspaces = settings?.recentWorkspaces ?? [];
	const target = settings?.targetWorkspace ?? workspaces[0] ?? "";

	const statusLine =
		session.phase === "saved"
			? "Saved"
			: session.phase === "error"
				? "Something went wrong"
				: "Ready to capture";

	const detailLine =
		session.phase === "error"
			? session.message
			: session.phase === "saved"
				? basename(session.filePath)
				: "Double-tap Shift to open and close";

	if (collapsed) {
		return (
			<div className="flex h-screen items-stretch overflow-hidden rounded-full border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur">
				<button
					type="button"
					onClick={() => void desktopApi.captureSetCollapsed(false)}
					className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left hover:bg-accent"
				>
					<MingcuteArrowLeftUp className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate text-xs font-medium">
						{hasNotes ? "Draft in progress" : "Capture"}
					</span>
				</button>
			</div>
		);
	}

	return (
		<div className="relative flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur">
			<div className="relative h-7 shrink-0" style={dragRegion}>
				<div
					className="absolute inset-y-0 right-1.5 flex items-center gap-0.5"
					style={noDragRegion}
				>
					<button
						type="button"
						title="Collapse"
						onClick={() => {
							setConfirmingClose(false);
							void desktopApi.captureSetCollapsed(true);
						}}
						className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<MingcuteArrowRightDown className="size-3.5" />
					</button>
					<button
						type="button"
						title="Close"
						onClick={requestClose}
						className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<MingcuteClose className="size-3.5" />
					</button>
				</div>
			</div>

			<div className="min-h-0 flex-1 text-sm">
				{draft === null ? null : (
					<EditorView
						key={draftGeneration}
						path={DRAFT_PATH}
						autoFocus
						initialMarkdown={draft}
						showFileProperties={false}
						showStatusBar={false}
						onLocalChange={onDraftChange}
						onSave={onDraftChange}
						onOpenExternalLink={(href) => void desktopApi.openExternalUrl(href)}
						onOpenWikiLink={() => {}}
					/>
				)}
			</div>

			<div className="shrink-0 border-t border-border p-3">
				<div className="flex items-center gap-3">
					<div className="min-w-0 flex-1">
						<p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
							{session.phase === "saved" ? (
								<MingcuteCheck className="size-4 shrink-0 text-primary" />
							) : null}
							{statusLine}
						</p>
						<p className="truncate text-xs text-muted-foreground">
							{detailLine}
						</p>
					</div>

					<select
						value={target}
						onChange={(event) => {
							const next = event.currentTarget.value;
							setSettings((current) =>
								current ? { ...current, targetWorkspace: next } : current,
							);
							void desktopApi.captureUpdateSettings({ targetWorkspace: next });
						}}
						className="max-w-[40%] truncate rounded border border-border bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground outline-none"
					>
						{workspaces.length === 0 ? (
							<option value="">No workspace</option>
						) : (
							workspaces.map((path) => (
								<option key={path} value={path}>
									{basename(path)}
								</option>
							))
						)}
					</select>

					<button
						type="button"
						disabled={!hasNotes || session.phase === "saved"}
						onClick={() => void desktopApi.captureSaveNotes()}
						className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						Save
					</button>
				</div>
			</div>

			{confirmingClose ? (
				<div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
					<div className="w-full max-w-64 rounded-lg border border-border bg-popover p-3 shadow-lg">
						<p className="text-[13px] font-medium">Close this note?</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Save it to your workspace or trash the draft.
						</p>
						<div className="mt-3 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setConfirmingClose(false)}
								className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={trashAndClose}
								className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
							>
								Trash
							</button>
							<button
								type="button"
								onClick={saveAndClose}
								className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
							>
								Save
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
