import { SidebarFileActionsMenu, useCommandShortcutLabel } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import {
	type ComponentProps,
	type FocusEvent,
	memo,
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
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
import { type FileEntry, viewerStore } from "../store/state";

type InboxNote = { path: string; modifiedAt: number };
type InboxActions = Omit<
	ComponentProps<typeof SidebarFileActionsMenu>,
	| "file"
	| "label"
	| "open"
	| "onOpenChange"
	| "onRenameFile"
	| "onDeleteSelection"
>;

const nameCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

// Keyed by path and mtime so an edited note rereads, and an unchanged one never does.
const previewCache = new Map<string, NotePreview>();
// Each note's newest preview, shown while an edited note rereads so the row
// never flashes back to its file name.
const latestPreview = new Map<string, NotePreview>();
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
	actions,
}: {
	workspacePath: string;
	files: FileEntry[];
	pinnedNotes: string[];
	currentPath: string | null;
	onOpen: (path: string) => void;
	/** The tree's file actions, minus the tree-only ones (rename, bulk). */
	actions: InboxActions;
}) {
	const showFullPath = useOptionKeyHeld();
	const [menuPath, setMenuPath] = useState<string | null>(null);
	const navRef = useRef<HTMLElement>(null);

	// Reveal the open note when the inbox appears or another note opens,
	// without taking focus.
	useEffect(() => {
		if (!currentPath) return;
		navRef.current
			?.querySelector('[aria-current="page"]')
			?.scrollIntoView({ block: "nearest" });
	}, [currentPath]);
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
	const previewFor = useNotePreviews([...pinned, ...recent]);
	const order = groups.flatMap((group) => group.items.map((note) => note.path));

	// Arrow keys move through notes in list order and open each one.
	function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
		const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
		if (!step || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		const focused =
			(document.activeElement as HTMLElement | null)?.dataset.inboxPath ??
			currentPath;
		const index = focused ? order.indexOf(focused) : -1;
		const next = index === -1 ? order[0] : order[index + step];
		if (!next || next === focused) return;
		onOpen(next);
		focusRow(event.currentTarget, next);
	}

	// The sidebar focuses this nav (e.g. Cmd+Shift+I); hand focus to the open note.
	function handleFocus(event: FocusEvent<HTMLElement>) {
		if (event.target !== event.currentTarget) return;
		const target =
			currentPath && order.includes(currentPath) ? currentPath : order[0];
		if (target) focusRow(event.currentTarget, target);
	}

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
			ref={navRef}
			aria-label="Recent files"
			data-sidebar-nav
			tabIndex={-1}
			onKeyDown={handleKeyDown}
			onFocus={handleFocus}
			className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [--muted-warm:oklch(from_var(--muted-foreground)_l_calc(c+0.02)_75)]"
		>
			{groups.map((group) => (
				<section key={group.label} aria-label={group.label}>
					<h2 className="px-2 pt-4 pb-1.5 text-[13px] font-bold text-sidebar-foreground">
						{group.label}
					</h2>
					<ul>
						{group.items.map((note) => {
							const preview = previewFor(note);
							return (
								<InboxRow
									key={note.path}
									path={note.path}
									modifiedAt={note.modifiedAt}
									title={preview?.title ?? basename(note.path)}
									description={
										preview ? (preview.description ?? "No additional text") : ""
									}
									workspacePath={workspacePath}
									isCurrent={note.path === currentPath}
									isPinned={pinnedSet.has(note.path)}
									showFullPath={showFullPath}
									menuOpen={menuPath === note.path}
									actions={actions}
									onOpen={onOpen}
									setMenuPath={setMenuPath}
								/>
							);
						})}
					</ul>
				</section>
			))}
		</nav>
	);
}

/**
 * One inbox row, with plain-value props so unchanged rows can be skipped.
 * `memo` is deliberate: the React compiler can't reuse elements created in a
 * loop, so without it every row re-renders on each keystroke and autosave.
 */
const InboxRow = memo(function InboxRow({
	path,
	modifiedAt,
	title,
	description,
	workspacePath,
	isCurrent,
	isPinned,
	showFullPath,
	menuOpen,
	actions,
	onOpen,
	setMenuPath,
}: {
	path: string;
	modifiedAt: number;
	title: string;
	description: string;
	workspacePath: string;
	isCurrent: boolean;
	isPinned: boolean;
	showFullPath: boolean;
	menuOpen: boolean;
	actions: InboxActions;
	onOpen: (path: string) => void;
	// The state setter itself, which never changes, so rows stay memoized.
	setMenuPath: (path: string | null) => void;
}) {
	// The actions menu is only visible on hover, so only build it then; a menu
	// per row is costly across thousands of notes.
	const [hovered, setHovered] = useState(false);
	const relativePath = relativeWorkspacePath(path, workspacePath);
	const folder = dirname(relativePath);
	// Lead with the workspace folder so top-level notes still show a dir.
	const fullPath = `${basename(workspacePath)}/${relativePath}`;
	return (
		<li
			// Separators inset to the text, hidden beside a highlighted row.
			className="group/sidebar-row relative not-first:before:absolute not-first:before:inset-x-2 not-first:before:top-0 not-first:before:h-px not-first:before:bg-sidebar-border has-[>button:hover]:before:hidden has-[>button[aria-current]]:before:hidden [li:has(>button:hover)+&]:before:hidden [li:has(>button[aria-current])+&]:before:hidden"
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<button
				type="button"
				data-inbox-path={path}
				aria-current={isCurrent ? "page" : undefined}
				onClick={(event) =>
					event.metaKey || event.ctrlKey
						? actions.onOpenFileInNewTab?.(path)
						: onOpen(path)
				}
				onContextMenu={(event) => {
					event.preventDefault();
					setMenuPath(path);
				}}
				className={cn(
					// Warm the muted text on yellow so it doesn't read muddy.
					"my-0.5 flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-start [--row-muted:var(--muted-foreground)] hover:[--row-muted:var(--muted-warm)]",
					isCurrent
						? "bg-sidebar-accent text-sidebar-accent-foreground [--row-muted:var(--muted-warm)]"
						: "hover:bg-accent",
				)}
			>
				{/* Leaves room for the actions buttons over this line. */}
				<span
					className={cn(
						"truncate text-[13px] font-semibold text-sidebar-foreground",
						isPinned ? "pe-11" : "pe-6",
					)}
				>
					{isCurrent ? (
						<LiveText
							path={path}
							field="title"
							saved={title}
							empty={basename(path)}
						/>
					) : (
						title
					)}
				</span>
				<span className="flex min-w-0 gap-1.5 text-xs">
					<span className="shrink-0 tabular-nums text-sidebar-foreground">
						{inboxDateLabel(modifiedAt)}
					</span>
					<span className="truncate text-(--row-muted)">
						{isCurrent ? (
							<LiveText
								path={path}
								field="description"
								saved={description}
								empty="No additional text"
							/>
						) : (
							description
						)}
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
								{folder ? basename(folder) : basename(workspacePath)}
							</span>
						</>
					)}
				</span>
			</button>
			{hovered || menuOpen ? (
				<div className="absolute end-1.5 top-[7px] flex">
					<SidebarFileActionsMenu
						{...actions}
						file={{ path, pinned: isPinned }}
						label={title}
						open={menuOpen}
						onOpenChange={(open) => setMenuPath(open ? path : null)}
					/>
				</div>
			) : null}
		</li>
	);
});

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

	return (note: InboxNote) =>
		previewCache.get(previewKey(note)) ?? latestPreview.get(note.path);
}

/**
 * The open note's title or preview, following the editor as you type. Only
 * the open note's row renders this, so typing never re-renders the list. It
 * selects the string, not the text, so edits past the first lines don't
 * re-render even this row.
 */
function LiveText({
	path,
	field,
	saved,
	empty,
}: {
	path: string;
	field: keyof NotePreview;
	/** Shown until the editor has this note's text. */
	saved: string;
	/** Shown when the live text has no such line. */
	empty: string;
}) {
	const live = useStoreValue(viewerStore, (doc) => {
		if (doc.status !== "ready" || doc.currentPath !== path) return undefined;
		if (!hasMarkdownExtension(path)) return undefined;
		return notePreview(doc.content)[field];
	});
	if (live === undefined) return saved;
	return live ?? empty;
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
	latestPreview.set(path, preview);
}

function focusRow(nav: HTMLElement, path: string) {
	const row = [...nav.querySelectorAll<HTMLElement>("[data-inbox-path]")].find(
		(element) => element.dataset.inboxPath === path,
	);
	row?.focus({ preventScroll: true });
	row?.scrollIntoView({ block: "nearest" });
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
