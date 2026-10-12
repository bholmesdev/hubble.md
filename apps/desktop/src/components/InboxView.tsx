import { useCommandShortcutLabel } from "@hubble.md/ui";
import { useEffect, useState } from "react";
import MingcuteFileLine from "~icons/mingcute/file-line";
import MingcuteFolderLine from "~icons/mingcute/folder-line";
import MingcuteFoldersLine from "~icons/mingcute/folders-line";
import MingcuteInboxLine from "~icons/mingcute/inbox-line";
import { desktopApi } from "../desktopApi";
import {
	basename,
	dirname,
	hasHtmlExtension,
	hasMarkdownExtension,
	relativeWorkspacePath,
} from "../lib/filePath";
import {
	groupInboxItems,
	type InboxGroup,
	inboxDateLabel,
} from "../lib/inboxGroups";
import { type NotePreview, notePreview } from "../lib/titleGeneration";
import { cn } from "../lib/utils";
import type { SidebarView } from "../store/persistence";
import type { FileEntry } from "../store/state";

type InboxNote = { path: string; modifiedAt: number };

const nameCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

// Keyed by path and mtime so an edited note rereads, and an unchanged one never does.
const previewCache = new Map<string, NotePreview>();
const PREVIEW_BATCH_SIZE = 20;
const previewKey = (note: InboxNote) => `${note.modifiedAt}:${note.path}`;

export function SidebarViewToggle({
	view,
	onChange,
}: {
	view: SidebarView;
	onChange: (view: SidebarView) => void;
}) {
	const options = [
		{
			value: "folders",
			label: "Folders",
			title: useCommandShortcutLabel("Folders", "app.show-folders"),
			Icon: MingcuteFoldersLine,
		},
		{
			value: "inbox",
			label: "Inbox",
			title: useCommandShortcutLabel("Inbox", "app.show-inbox"),
			Icon: MingcuteInboxLine,
		},
	] as const;
	return (
		<fieldset
			aria-label="Sidebar view"
			className="flex shrink-0 items-center rounded-sm bg-muted"
		>
			{options.map(({ value, label, title, Icon }) => (
				<button
					key={value}
					type="button"
					aria-pressed={view === value}
					aria-label={label}
					title={title}
					onClick={() => onChange(value)}
					className={cn(
						// Full-height and flush, so the selected button is the container's edge.
						"inline-flex h-6 w-7 cursor-pointer items-center justify-center rounded-sm border transition-colors",
						view === value
							? "border-border bg-background text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
				>
					{/* Hovering the SVG would otherwise hide the button's native title tooltip. */}
					<Icon className="pointer-events-none size-3.5" />
				</button>
			))}
		</fieldset>
	);
}

export function InboxView({
	workspacePath,
	files,
	pinnedNotes,
	currentPath,
	onOpen,
	onOpenInNewTab,
}: {
	workspacePath: string;
	files: FileEntry[];
	pinnedNotes: string[];
	currentPath: string | null;
	onOpen: (path: string) => void;
	onOpenInNewTab: (path: string) => void;
}) {
	const showFullPath = useOptionKeyHeld();
	// Only list files Hubble can create as notes. Mtimes are stored in seconds.
	const notes = new Map(
		files
			.filter((file) => isCreatableNote(file.path))
			.map((file) => [
				file.path,
				{ path: file.path, modifiedAt: file.modified_at * 1000 },
			]),
	);
	const pinned = pinnedNotes
		.map((path) => notes.get(path))
		.filter((note): note is InboxNote => note !== undefined);
	const pinnedSet = new Set(pinnedNotes);
	const recent = [...notes.values()]
		.filter((note) => !pinnedSet.has(note.path))
		// Break mtime ties by name, like the folder view's Recent sort.
		.sort(
			(a, b) =>
				b.modifiedAt - a.modifiedAt ||
				nameCollator.compare(basename(a.path), basename(b.path)),
		);
	const groups: InboxGroup<InboxNote>[] = [
		...(pinned.length ? [{ label: "Pinned", items: pinned }] : []),
		...groupInboxItems(recent, (note) => note.modifiedAt),
	];
	const previews = useNotePreviews([...pinned, ...recent]);

	if (groups.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-xs text-muted-foreground">
				<MingcuteInboxLine className="size-5" />
				<p>No files in this folder yet.</p>
			</div>
		);
	}

	return (
		<nav
			aria-label="Recent files"
			className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [--muted-warm:oklch(from_var(--muted-foreground)_l_calc(c+0.02)_75)]"
		>
			{groups.map((group) => (
				<section key={group.label} aria-label={group.label}>
					<h2 className="px-2 pt-4 pb-1.5 text-[13px] font-bold text-sidebar-foreground">
						{group.label}
					</h2>
					<ul>
						{group.items.map((note) => {
							const preview = previews.get(previewKey(note));
							const relativePath = relativeWorkspacePath(
								note.path,
								workspacePath,
							);
							const folder = dirname(relativePath);
							// Lead with the workspace folder so top-level notes still show a dir.
							const fullPath = `${basename(workspacePath)}/${relativePath}`;
							const isCurrent = note.path === currentPath;
							return (
								<li
									key={note.path}
									// Separators inset to the text, hidden beside a highlighted row.
									className="relative not-first:before:absolute not-first:before:inset-x-2 not-first:before:top-0 not-first:before:h-px not-first:before:bg-sidebar-border has-[>button:hover]:before:hidden has-[>button[aria-current]]:before:hidden [li:has(>button:hover)+&]:before:hidden [li:has(>button[aria-current])+&]:before:hidden"
								>
									<button
										type="button"
										aria-current={isCurrent ? "page" : undefined}
										onClick={(event) =>
											event.metaKey || event.ctrlKey
												? onOpenInNewTab(note.path)
												: onOpen(note.path)
										}
										className={cn(
											// Warm the muted text on yellow so it doesn't read muddy.
											"my-0.5 flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-start [--row-muted:var(--muted-foreground)] hover:[--row-muted:var(--muted-warm)]",
											isCurrent
												? "bg-sidebar-accent text-sidebar-accent-foreground [--row-muted:var(--muted-warm)]"
												: "hover:bg-accent",
										)}
									>
										<span className="truncate text-[13px] font-semibold text-sidebar-foreground">
											{preview?.title ?? basename(note.path)}
										</span>
										<span className="flex min-w-0 gap-1.5 text-xs">
											<span className="shrink-0 tabular-nums text-sidebar-foreground">
												{inboxDateLabel(note.modifiedAt)}
											</span>
											<span className="truncate text-(--row-muted)">
												{preview
													? (preview.description ?? "No additional text")
													: ""}
											</span>
										</span>
										<span
											className="flex min-w-0 items-center gap-1 text-xs text-(--row-muted)"
											title={fullPath}
										>
											{showFullPath ? (
												<>
													<MingcuteFileLine className="pointer-events-none size-3.5 shrink-0" />
													<span className="truncate">{fullPath}</span>
												</>
											) : (
												<>
													<MingcuteFolderLine className="pointer-events-none size-3.5 shrink-0" />
													<span className="truncate">
														{folder
															? basename(folder)
															: basename(workspacePath)}
													</span>
												</>
											)}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</nav>
	);
}

/** Reads each Markdown note's first lines once per mtime. */
function useNotePreviews(notes: InboxNote[]) {
	const [, setVersion] = useState(0);
	const missingKey = notes
		.map(previewKey)
		.filter((key) => !previewCache.has(key))
		.join("\n");

	useEffect(() => {
		if (!missingKey) return;
		let cancelled = false;
		// Read in list order, a batch at a time, so the top rows fill in first.
		void (async () => {
			const keys = missingKey.split("\n");
			for (let start = 0; start < keys.length; start += PREVIEW_BATCH_SIZE) {
				if (cancelled) return;
				await Promise.all(
					keys.slice(start, start + PREVIEW_BATCH_SIZE).map(readPreview),
				);
				if (!cancelled) setVersion((version) => version + 1);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [missingKey]);

	return previewCache;
}

function isCreatableNote(path: string) {
	return hasMarkdownExtension(path) || hasHtmlExtension(path);
}

async function readPreview(key: string) {
	const path = key.slice(key.indexOf(":") + 1);
	let preview: NotePreview = {
		title: null,
		description: hasHtmlExtension(path) ? "HTML App" : null,
	};
	if (hasMarkdownExtension(path)) {
		try {
			preview = notePreview(await desktopApi.readFileText(path));
		} catch {
			// Unreadable files fall back to their file name.
		}
	}
	previewCache.set(key, preview);
}

/** Tracks whether Option (Alt) is held, resetting when the window loses focus. */
function useOptionKeyHeld() {
	const [held, setHeld] = useState(false);
	useEffect(() => {
		const update = (event: KeyboardEvent) => setHeld(event.altKey);
		const reset = () => setHeld(false);
		window.addEventListener("keydown", update);
		window.addEventListener("keyup", update);
		window.addEventListener("blur", reset);
		return () => {
			window.removeEventListener("keydown", update);
			window.removeEventListener("keyup", update);
			window.removeEventListener("blur", reset);
		};
	}, []);
	return held;
}
