import { EditorView } from "@hubble.md/ui";
import { useCallback, useEffect, useState } from "react";
import MingcuteCheck from "~icons/mingcute/check-circle-line";
import { desktopApi } from "../desktopApi";
import type { CaptureSessionState, CaptureSettings } from "../desktopApi/types";

/** EditorView keys its state by path; the notepad is not a real file. */
const DRAFT_PATH = "capture://draft";

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
	// Remounts the editor after a save so it picks up the cleared draft.
	const [draftGeneration, setDraftGeneration] = useState(0);

	useEffect(() => {
		void desktopApi.captureGetState().then((state) => {
			setSettings(state.settings);
			setSession(state.session);
		});
		void desktopApi.captureGetDraft().then((markdown) => {
			setDraft(markdown);
			setHasNotes(markdown.trim().length > 0);
		});
		return desktopApi.onCaptureSessionState(setSession);
	}, []);

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
			void desktopApi.captureGetDraft().then((markdown) => {
				setDraft(markdown);
				setHasNotes(markdown.trim().length > 0);
				setDraftGeneration((generation) => generation + 1);
			});
		}),
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			void desktopApi.captureHideWindow();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const onDraftChange = useCallback((_path: string, markdown: string) => {
		setHasNotes(markdown.trim().length > 0);
		void desktopApi.captureSetDraft(markdown);
	}, []);

	const workspaces = settings?.recentWorkspaces ?? [];
	const target = settings?.targetWorkspace ?? workspaces[0] ?? "";

	const statusLine =
		session.phase === "saved"
			? "Saved to Captures"
			: session.phase === "error"
				? "Something went wrong"
				: "Ready to capture";

	const detailLine =
		session.phase === "error"
			? session.message
			: session.phase === "saved"
				? basename(session.filePath)
				: "Double-tap Shift to open and close";

	return (
		<div className="flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur">
			<div
				className="h-6 shrink-0"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			/>

			<div className="min-h-0 flex-1 text-sm">
				{draft === null ? null : (
					<EditorView
						key={draftGeneration}
						path={DRAFT_PATH}
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
		</div>
	);
}
