import { EditorView } from "@hubble.md/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import MingcuteArrowLeftUp from "~icons/mingcute/arrow-left-up-line";
import MingcuteArrowRightDown from "~icons/mingcute/arrow-right-down-line";
import MingcuteCheckCircle from "~icons/mingcute/check-circle-line";
import MingcuteCheck from "~icons/mingcute/check-line";
import MingcuteClose from "~icons/mingcute/close-line";
import MingcuteDelete from "~icons/mingcute/delete-2-line";
import { desktopApi } from "../desktopApi";
import type { CaptureSessionState, CaptureSettings } from "../desktopApi/types";
import { captureTitleFromMarkdown } from "./titleFromMarkdown";

/** EditorView keys its state by path; the notepad is not a real file. */
const DRAFT_PATH = "capture://draft";

/** Two Escape taps inside this window collapse the panel into the pill. */
const DOUBLE_ESCAPE_MS = 500;

const dragRegion = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

/** Same green as editor hyperlinks; the foreground mix adapts to light/dark. */
const linkGreen = {
	backgroundColor: "color-mix(in oklab, var(--brand) 48%, var(--foreground))",
	color: "var(--background)",
} as React.CSSProperties;

/** How far a press can wander and still count as a click on the pill. */
const PILL_CLICK_SLOP_PX = 5;

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
	const [confirmingTrash, setConfirmingTrash] = useState(false);
	// Remounts the editor after a save so it picks up the cleared draft.
	const [draftGeneration, setDraftGeneration] = useState(0);
	// The note names itself from its first line until the user types their own.
	const [generatedTitle, setGeneratedTitle] = useState("");
	const [titleOverride, setTitleOverride] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const trashCancelRef = useRef<HTMLButtonElement | null>(null);

	const title = titleOverride ?? generatedTitle;

	// The main process owns the draft; edits made before a collapse or on
	// another route only reach this window through a reload.
	const reloadDraft = useCallback(() => {
		void desktopApi.captureGetDraft().then((markdown) => {
			setDraft(markdown);
			setHasNotes(markdown.trim().length > 0);
			setGeneratedTitle(captureTitleFromMarkdown(markdown));
			// An empty draft is a fresh note; a hand-typed title belongs to the old one.
			if (markdown.trim().length === 0) setTitleOverride(null);
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

	useEffect(() => {
		if (session.phase !== "saved") return;
		setDraft("");
		setHasNotes(false);
		setGeneratedTitle("");
		setTitleOverride(null);
		setDraftGeneration((generation) => generation + 1);
	}, [session]);

	// Reload the draft each time the panel reappears; the draft or the target
	// workspace may have changed since this window last rendered.
	useEffect(() =>
		desktopApi.onCaptureWindowShown(() => {
			setConfirmingTrash(false);
			reloadDraft();
			void desktopApi
				.captureGetState()
				.then((state) => setSettings(state.settings));
		}),
	);

	const saveNotes = useCallback(
		(saveAs?: boolean) =>
			void desktopApi.captureSaveNotes(title || null, saveAs === true),
		[title],
	);

	const requestTrash = useCallback(() => {
		// Nothing written yet, so there is nothing to lose; just put the panel away.
		if (!hasNotes) {
			void desktopApi.captureCloseWindow();
			return;
		}
		setConfirmingTrash(true);
	}, [hasNotes]);

	// Capture phase, because editor popovers legitimately consume single Escape
	// presses; a quick double tap collapses the panel no matter who ate them.
	useEffect(() => {
		let lastEscapeAt = 0;
		const onKeyDown = (event: KeyboardEvent) => {
			const modifier = event.metaKey || event.ctrlKey;
			if (modifier && event.key.toLowerCase() === "w") {
				event.preventDefault();
				void desktopApi.captureCloseWindow();
				return;
			}
			if (modifier && event.shiftKey && event.key.toLowerCase() === "s") {
				event.preventDefault();
				saveNotes(true);
				return;
			}
			if (event.key !== "Escape" || event.repeat) return;
			if (confirmingTrash) {
				setConfirmingTrash(false);
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
	}, [confirmingTrash, saveNotes]);

	const onDraftChange = useCallback((_path: string, markdown: string) => {
		setHasNotes(markdown.trim().length > 0);
		setGeneratedTitle(captureTitleFromMarkdown(markdown));
		void desktopApi.captureSetDraft(markdown);
	}, []);

	useEffect(() => {
		if (!editingTitle) return;
		titleInputRef.current?.focus();
		titleInputRef.current?.select();
	}, [editingTitle]);

	// Pull keyboard focus out of the editor while the trash prompt is up;
	// otherwise typing keeps landing in the note behind the overlay.
	useEffect(() => {
		if (confirmingTrash) trashCancelRef.current?.focus();
	}, [confirmingTrash]);

	const beginTitleEdit = () => {
		setTitleDraft(title);
		setEditingTitle(true);
	};

	const commitTitleEdit = () => {
		setEditingTitle(false);
		const next = titleDraft.trim();
		setTitleOverride(next && next !== generatedTitle ? next : null);
	};

	const trashNote = () => {
		setConfirmingTrash(false);
		void desktopApi.captureDiscardDraft().then(() => {
			setDraft("");
			setHasNotes(false);
			setGeneratedTitle("");
			setTitleOverride(null);
			setDraftGeneration((generation) => generation + 1);
			void desktopApi.captureCloseWindow();
		});
	};

	// The pill drags by hand instead of using a native drag region, because a
	// drag region would also swallow the click that expands it.
	const pillDrag = useRef<{
		pointerX: number;
		pointerY: number;
		windowX: number;
		windowY: number;
		moved: boolean;
	} | null>(null);

	const onPillPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		pillDrag.current = {
			pointerX: event.screenX,
			pointerY: event.screenY,
			windowX: window.screenX,
			windowY: window.screenY,
			moved: false,
		};
	};

	const onPillPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = pillDrag.current;
		if (!drag) return;
		const dx = event.screenX - drag.pointerX;
		const dy = event.screenY - drag.pointerY;
		if (!drag.moved && Math.abs(dx) + Math.abs(dy) < PILL_CLICK_SLOP_PX) return;
		drag.moved = true;
		void desktopApi.captureMoveWindow(
			Math.round(drag.windowX + dx),
			Math.round(drag.windowY + dy),
		);
	};

	const onPillPointerUp = () => {
		const drag = pillDrag.current;
		pillDrag.current = null;
		if (drag && !drag.moved) void desktopApi.captureSetCollapsed(false);
	};

	const workspaces = settings?.recentWorkspaces ?? [];
	const target = settings?.targetWorkspace ?? workspaces[0] ?? null;
	const saveHint = target ? `Save to ${basename(target)}` : "Save";

	if (collapsed) {
		return (
			<div
				className="flex h-screen select-none items-center gap-2 overflow-hidden rounded-xl border border-border bg-popover/95 pl-3 pr-1.5 text-popover-foreground shadow-lg backdrop-blur"
				onPointerDown={onPillPointerDown}
				onPointerMove={onPillPointerMove}
				onPointerUp={onPillPointerUp}
			>
				<MingcuteArrowLeftUp className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate text-xs font-medium">
					{title || (hasNotes ? "Draft in progress" : "Capture")}
				</span>
				<button
					type="button"
					title="Close"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={() => void desktopApi.captureCloseWindow()}
					className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<MingcuteClose className="size-3.5" />
				</button>
			</div>
		);
	}

	return (
		<div className="relative flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur">
			<div className="relative h-8 shrink-0" style={dragRegion}>
				<div
					className="absolute inset-y-0 left-1.5 flex items-center"
					style={noDragRegion}
				>
					<button
						type="button"
						title="Collapse"
						onClick={() => {
							setConfirmingTrash(false);
							void desktopApi.captureSetCollapsed(true);
						}}
						className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<MingcuteArrowRightDown className="size-4" />
					</button>
				</div>
				<div className="absolute inset-x-20 inset-y-0 flex items-center justify-center">
					{editingTitle ? (
						<input
							ref={titleInputRef}
							className="h-5 min-w-0 max-w-full select-text rounded-sm bg-transparent px-1 text-center text-xs text-foreground outline-none"
							style={noDragRegion}
							value={titleDraft}
							onBlur={commitTitleEdit}
							onChange={(event) => setTitleDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									commitTitleEdit();
								} else if (event.key === "Escape") {
									event.preventDefault();
									setEditingTitle(false);
								}
							}}
						/>
					) : (
						<button
							type="button"
							className="min-w-0 truncate rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground"
							style={noDragRegion}
							onClick={beginTitleEdit}
						>
							{title || "New capture"}
						</button>
					)}
				</div>
				<div
					className="absolute inset-y-0 right-1.5 flex items-center gap-1"
					style={noDragRegion}
				>
					<button
						type="button"
						title="Trash note"
						disabled={session.phase === "saved"}
						onClick={requestTrash}
						className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40"
					>
						<MingcuteDelete className="size-4" />
					</button>
					<button
						type="button"
						title={saveHint}
						disabled={!hasNotes || session.phase === "saved"}
						onClick={() => saveNotes()}
						style={linkGreen}
						className="rounded-full p-1 hover:brightness-110 disabled:opacity-40"
					>
						<MingcuteCheck className="size-4" />
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

			{session.phase === "saved" ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
					<div className="flex max-w-[85%] items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 shadow-md">
						<MingcuteCheckCircle className="size-4 shrink-0 text-primary" />
						<span className="truncate text-xs font-medium">
							{basename(session.filePath)}
						</span>
					</div>
				</div>
			) : null}

			{session.phase === "error" ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
					<div className="max-w-[85%] truncate rounded-full border border-destructive/50 bg-popover px-3 py-1.5 text-xs font-medium text-destructive shadow-md">
						{session.message}
					</div>
				</div>
			) : null}

			{confirmingTrash ? (
				<div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
					<div className="w-full max-w-64 rounded-lg border border-border bg-popover p-3 shadow-lg">
						<p className="text-[13px] font-medium">Trash this note?</p>
						<p className="mt-1 text-xs text-muted-foreground">
							The draft is deleted and cannot be recovered.
						</p>
						<div className="mt-3 flex items-center justify-end gap-2">
							<button
								ref={trashCancelRef}
								type="button"
								onClick={() => setConfirmingTrash(false)}
								className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={trashNote}
								className="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/20"
							>
								Trash
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
