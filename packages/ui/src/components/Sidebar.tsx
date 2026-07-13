import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import {
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	type Modifier,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { keymatch } from "keymatch";
import {
	type CSSProperties,
	forwardRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteAzSortAscendingLettersLine from "~icons/mingcute/az-sort-ascending-letters-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCodeLine from "~icons/mingcute/code-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteDeleteLine from "~icons/mingcute/delete-line";
import MingcuteEditLine from "~icons/mingcute/edit-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import MingcuteNewFolderLine from "~icons/mingcute/new-folder-line";
import MingcutePinFill from "~icons/mingcute/pin-fill";
import MingcutePinLine from "~icons/mingcute/pin-line";
import MingcuteRightLine from "~icons/mingcute/right-line";
import MingcuteSortDescendingLine from "~icons/mingcute/sort-descending-line";
import { useResizeSeparator } from "../hooks/useResizeSeparator";
import { isEditableEventTarget } from "../lib/dom";
import {
	dirname,
	fileNameFromPath,
	normalizeDisplayPath,
	splitFileName,
} from "../lib/filePath";
import { shouldShowFooterDivider } from "../lib/scrollOverflow";
import { formatShortcut } from "../lib/shortcut";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { useSidebarKeyboardNav } from "./useSidebarKeyboardNav";
import {
	type SidebarFile,
	type SidebarFolder,
	type SidebarRow,
	type SidebarSortMode,
	useSidebarTree,
} from "./useSidebarTree";

export type { SidebarFile, SidebarFolder, SidebarSortMode };

export type SidebarMoveItem =
	| { kind: "file"; path: string }
	| { kind: "folder"; folderId: string };

export type SidebarMoveItemInput = {
	items: SidebarMoveItem[];
	targetFolderId: string | null;
};

export type SidebarFocusedItem =
	| { kind: "file"; path: string }
	| { kind: "folder"; folderId: string }
	| null;

type RenameItem =
	| { kind: "file"; path: string }
	| {
			kind: "folder";
			path: string;
			displayPath: string;
			parentDisplayPath: string;
	  };

type SidebarSelectableRow = Extract<SidebarRow, { kind: "file" | "folder" }>;
export type SidebarActionSelection = {
	files: SidebarFile[];
	folders: string[];
	count: number;
};

export type SidebarSelectionState = {
	selectedKeys: Set<string>;
	anchorKey: string | null;
};

export type SidebarSelectionMode =
	// plain click: select only this row
	| "replace"
	// cmd/ctrl click: add or remove this row from the selection
	| "toggle"
	// shift click: select every row between the anchor and this row
	| "range";

export type SidebarMoveCandidate =
	| {
			kind: "file";
			path: string;
			key: string;
			parentFolderId: string | null;
	  }
	| {
			kind: "folder";
			folderId: string;
			key: string;
			parentFolderId: string | null;
	  };

function sidebarFileKey(path: string) {
	return `file:${path}`;
}

export function sidebarRowKey(row: SidebarRow): string | null {
	if (row.kind === "section") return null;
	return row.kind === "file"
		? sidebarFileKey(row.file.path)
		: `folder:${row.id}`;
}

/**
 * Snaps the click selection to the active file. A file can become active
 * without a row click (history navigation, note links), and the selection
 * highlight would otherwise stay on the last clicked row.
 */
export function snapSidebarSelection(
	selection: SidebarSelectionState,
	activePath: string | null,
): SidebarSelectionState {
	const key = activePath ? sidebarFileKey(activePath) : null;
	const unchanged = key
		? selection.selectedKeys.size === 1 && selection.selectedKeys.has(key)
		: selection.selectedKeys.size === 0;
	if (unchanged) return selection;
	return {
		selectedKeys: new Set(key ? [key] : []),
		anchorKey: key,
	};
}

export function applySidebarSelection({
	anchorKey,
	mode,
	rows,
	selectedKeys,
	targetKey,
}: {
	anchorKey: string | null;
	mode: SidebarSelectionMode;
	rows: SidebarRow[];
	selectedKeys: Set<string>;
	targetKey: string | null;
}): SidebarSelectionState {
	const rowKeys = rows.map(sidebarRowKey);
	const selectableKeys = new Set(rowKeys.filter((key) => key !== null));
	if (!targetKey || !selectableKeys.has(targetKey)) {
		return { selectedKeys, anchorKey };
	}
	if (mode === "replace") {
		return { selectedKeys: new Set([targetKey]), anchorKey: targetKey };
	}
	if (mode === "toggle") {
		const next = new Set(selectedKeys);
		if (next.has(targetKey)) next.delete(targetKey);
		else next.add(targetKey);
		return { selectedKeys: next, anchorKey: targetKey };
	}

	const anchorIndex = anchorKey ? rowKeys.indexOf(anchorKey) : -1;
	const targetIndex = rowKeys.indexOf(targetKey);
	if (anchorIndex < 0 || targetIndex < 0) {
		return { selectedKeys: new Set([targetKey]), anchorKey: targetKey };
	}
	const [start, end] =
		anchorIndex < targetIndex
			? [anchorIndex, targetIndex]
			: [targetIndex, anchorIndex];
	return {
		selectedKeys: new Set(
			rowKeys.slice(start, end + 1).filter((key) => key !== null),
		),
		anchorKey,
	};
}

function pruneSidebarSelection(
	selection: SidebarSelectionState,
	rows: SidebarRow[],
): SidebarSelectionState {
	const validKeys = new Set(
		rows.map(sidebarRowKey).filter((key) => key !== null),
	);
	const nextKeys = new Set(
		[...selection.selectedKeys].filter((key) => validKeys.has(key)),
	);
	const nextAnchor =
		selection.anchorKey && validKeys.has(selection.anchorKey)
			? selection.anchorKey
			: null;
	if (
		nextAnchor === selection.anchorKey &&
		nextKeys.size === selection.selectedKeys.size &&
		[...nextKeys].every((key) => selection.selectedKeys.has(key))
	) {
		return selection;
	}
	return { selectedKeys: nextKeys, anchorKey: nextAnchor };
}

export function sidebarMoveCandidateFromRow(
	row: SidebarRow,
	getDisplayPath: (path: string) => string,
): SidebarMoveCandidate | null {
	const key = sidebarRowKey(row);
	if (!key || row.kind === "section") return null;
	return row.kind === "file"
		? {
				kind: "file",
				path: row.file.path,
				key,
				// folderIds live in the display-path namespace, but file rows
				// carry an absolute disk path, so map it back to a display path
				// before deriving the parent folderId.
				parentFolderId: folderIdFromDisplayPath(getDisplayPath(row.file.path)),
			}
		: {
				kind: "folder",
				folderId: row.id,
				key,
				parentFolderId: parentFolderId(row.id),
			};
}

function sidebarMoveItemFromCandidate(
	candidate: SidebarMoveCandidate,
): SidebarMoveItem {
	return candidate.kind === "file"
		? { kind: "file", path: candidate.path }
		: { kind: "folder", folderId: candidate.folderId };
}

export function sidebarMoveItemsForDrag({
	draggedItem,
	getDisplayPath,
	rows,
	selectedKeys,
	targetFolderId,
}: {
	draggedItem: SidebarMoveCandidate;
	getDisplayPath: (path: string) => string;
	rows: SidebarRow[];
	selectedKeys: Set<string>;
	targetFolderId: string | null;
}): SidebarMoveItem[] {
	const selectedCandidates = selectedKeys.has(draggedItem.key)
		? rows
				.map((row) => sidebarMoveCandidateFromRow(row, getDisplayPath))
				.filter(
					(candidate): candidate is SidebarMoveCandidate =>
						candidate !== null && selectedKeys.has(candidate.key),
				)
		: [draggedItem];
	const validCandidates = selectedCandidates.filter(
		(candidate) => !isInvalidMove(candidate, targetFolderId),
	);
	return removeDescendantMoveCandidates(validCandidates).map(
		sidebarMoveItemFromCandidate,
	);
}

function removeDescendantMoveCandidates(
	candidates: SidebarMoveCandidate[],
): SidebarMoveCandidate[] {
	// A moving folder already carries its descendants on disk.
	const selectedFolderIds = candidates
		.filter(
			(
				candidate,
			): candidate is Extract<SidebarMoveCandidate, { kind: "folder" }> =>
				candidate.kind === "folder",
		)
		.map((candidate) => candidate.folderId);
	return candidates.filter((candidate) => {
		if (candidate.kind === "folder") {
			return !selectedFolderIds.some(
				(folderId) =>
					folderId !== candidate.folderId &&
					candidate.folderId.startsWith(folderId),
			);
		}
		return !selectedFolderIds.some((folderId) =>
			candidate.parentFolderId?.startsWith(folderId),
		);
	});
}

const sidebarActionClass =
	"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-[11px] font-normal outline-hidden select-none";
const sidebarActionIconClass =
	"inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5";
const sidebarRowContentClass =
	"flex min-w-0 flex-1 items-center gap-1 [padding-block:var(--row-pad-block)] [padding-inline-end:1.25rem] text-start text-[length:var(--font-size-sidebar)]";
const sidebarRowActionButtonClass =
	"inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-transparent bg-transparent text-current opacity-0 outline-hidden transition-opacity group-hover/sidebar-row:opacity-100 aria-expanded:opacity-100 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40";
const DEFAULT_SIDEBAR_WIDTH = 220;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 360;
const COLLAPSE_EDGE_DISTANCE = 24;
const RESIZE_HANDLE_WIDTH = 10;
const DRAG_EXPAND_DELAY_MS = 500;
const DRAG_CHIP_OFFSET = 2;
const SEGMENT_DROP = "sidebar-drop:segment:";
const alignChipToCursor: Modifier = ({
	activeNodeRect,
	activatorEvent,
	transform,
}) => {
	if (!activeNodeRect || !(activatorEvent instanceof MouseEvent))
		return transform;
	return {
		...transform,
		x:
			transform.x +
			activatorEvent.clientX -
			activeNodeRect.left +
			DRAG_CHIP_OFFSET,
		y:
			transform.y +
			activatorEvent.clientY -
			activeNodeRect.top +
			DRAG_CHIP_OFFSET,
	};
};
const segmentFirstCollision: CollisionDetection = (args) => {
	const pointerCollisions = pointerWithin(args);
	const segmentCollisions = pointerCollisions.filter((collision) =>
		String(collision.id).startsWith(SEGMENT_DROP),
	);
	return segmentCollisions.length > 0 ? segmentCollisions : pointerCollisions;
};

function defaultGetDisplayPath(path: string) {
	return path;
}

export function Sidebar({
	files,
	folders = [],
	currentPath,
	pendingPath,
	sortMode,
	storageScope,
	header,
	footer,
	emptyState,
	getDisplayPath = defaultGetDisplayPath,
	onCollapse,
	onSortModeChange,
	onSelectFile,
	onRevealFile,
	onCopyFilePath,
	onRevealFolder,
	onFocusedItemChange,
	revealLabel,
	onRenameFile,
	onRenameFolder,
	onDeleteFile,
	onTogglePinnedFile,
	onCreateFile,
	onCreateHtmlFile,
	onCreateFolder,
	onDeleteFolder,
	onMoveItem,
}: {
	files: SidebarFile[];
	folders?: SidebarFolder[];
	currentPath: string | null;
	pendingPath?: string | null;
	sortMode: SidebarSortMode;
	/** Stable key used to persist folder expansion for one workspace/open folder. */
	storageScope?: string | null;
	header?: ReactNode;
	footer?: ReactNode;
	emptyState?: ReactNode;
	getDisplayPath?: (path: string) => string;
	onCollapse?: () => void;
	onSortModeChange: (mode: SidebarSortMode) => void;
	onSelectFile: (path: string) => void;
	onRevealFile?: (path: string) => void;
	onCopyFilePath?: (path: string) => void;
	onRevealFolder?: (folderId: string) => void;
	onFocusedItemChange?: (item: SidebarFocusedItem) => void;
	revealLabel?: string;
	onRenameFile?: (path: string, nextName: string) => void;
	onRenameFolder?: (
		folderId: string,
		nextName: string,
		targetDisplayPath: string,
	) => void;
	onDeleteFile?: (path: string) => void;
	onTogglePinnedFile?: (path: string) => void;
	onCreateFile?: (folderId: string | null) => Promise<string | null>;
	onCreateHtmlFile?: (folderId: string | null) => Promise<string | null>;
	onCreateFolder?: (folderId: string | null) => Promise<string | null>;
	onDeleteFolder?: (folderId: string) => void;
	onMoveItem?: (input: SidebarMoveItemInput) => Promise<void> | void;
}) {
	const navRef = useRef<HTMLDivElement>(null);
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const [openActionsPath, setOpenActionsPath] = useState<string | null>(null);
	const [renamingItem, setRenamingItem] = useState<RenameItem | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [showFooterBorder, setShowFooterBorder] = useState(false);
	const [deleteOnCancel, setDeleteOnCancel] = useState<{
		kind: RenameItem["kind"];
		path: string;
		draft: string;
	} | null>(null);
	const [renameError, setRenameError] = useState<string | null>(null);
	const [pendingFocusDisplayPath, setPendingFocusDisplayPath] = useState<
		string | null
	>(null);
	const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null);
	const [activeDragKeys, setActiveDragKeys] = useState<Set<string>>(new Set());
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const highlightPath = pendingPath ?? currentPath;
	const uncompactFolderId =
		deleteOnCancel?.kind === "folder" ? deleteOnCancel.path : null;
	const { collapseFolder, expandFolder, rows, toggleFolder } = useSidebarTree({
		files,
		folders,
		getDisplayPath,
		highlightPath,
		sortMode,
		storageScope,
		uncompactFolderId,
	});
	const [selection, setSelection] = useState<SidebarSelectionState>({
		selectedKeys: new Set(),
		anchorKey: null,
	});
	const selectedKeys = selection.selectedKeys;
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);
	const beginRename = (
		item: RenameItem,
		label: string,
		options?: { deleteOnUnchangedCancel?: boolean },
	) => {
		const name = splitFileName(label).name;
		setOpenActionsPath(null);
		setRenamingItem(item);
		setRenameDraft(name);
		setDeleteOnCancel(
			options?.deleteOnUnchangedCancel
				? { kind: item.kind, path: item.path, draft: name }
				: null,
		);
		setRenameError(null);
	};
	const createFile = async (folderId: string | null) => {
		if (!onCreateFile) return;
		setOpenActionsPath(null);
		if (folderId) expandFolder(folderId);
		const path = await onCreateFile(folderId);
		if (!path) return;
		beginRename(
			{ kind: "file", path },
			fileNameFromPath(getDisplayPath(path)),
			{
				deleteOnUnchangedCancel: true,
			},
		);
	};
	const createHtmlFile = async (folderId: string | null) => {
		if (!onCreateHtmlFile) return;
		setOpenActionsPath(null);
		if (folderId) expandFolder(folderId);
		const path = await onCreateHtmlFile(folderId);
		if (!path) return;
		beginRename(
			{ kind: "file", path },
			fileNameFromPath(getDisplayPath(path)),
			{
				deleteOnUnchangedCancel: true,
			},
		);
	};
	const createFolder = async (folderId: string | null) => {
		if (!onCreateFolder) return;
		setOpenActionsPath(null);
		if (folderId) expandFolder(folderId);
		const path = await onCreateFolder(folderId);
		if (!path) return;
		const displayPath = normalizeDisplayPath(getDisplayPath(path));
		const id = displayPath.endsWith("/") ? displayPath : `${displayPath}/`;
		beginRename(
			{
				kind: "folder",
				path: id,
				displayPath,
				parentDisplayPath: dirname(displayPath),
			},
			fileNameFromPath(displayPath),
			{
				deleteOnUnchangedCancel: true,
			},
		);
	};
	const activateRow = (row: SidebarRow) => {
		if (row.kind === "file") onSelectFile(row.file.path);
		else if (row.kind === "folder") toggleFolder(row.id);
	};
	const updateSelection = (row: SidebarRow, mode: SidebarSelectionMode) => {
		const targetKey = sidebarRowKey(row);
		setSelection((current) =>
			applySidebarSelection({
				anchorKey: current.anchorKey,
				mode,
				rows,
				selectedKeys: current.selectedKeys,
				targetKey,
			}),
		);
	};
	const replaceSelection = (row: SidebarRow) => {
		const targetKey = sidebarRowKey(row);
		setSelection((current) =>
			applySidebarSelection({
				anchorKey: current.anchorKey,
				mode: "replace",
				rows,
				selectedKeys: current.selectedKeys,
				targetKey,
			}),
		);
	};
	const handleRowClick = (
		row: SidebarSelectableRow,
		event: React.MouseEvent<HTMLButtonElement>,
	) => {
		const mode: SidebarSelectionMode = event.shiftKey
			? "range"
			: event.metaKey || event.ctrlKey
				? "toggle"
				: "replace";
		updateSelection(row, mode);
		if (mode !== "replace") {
			event.preventDefault();
			return;
		}
		if (row.kind === "file" && event.detail > 1) return;
		activateRow(row);
		requestAnimationFrame(() => navRef.current?.focus());
	};
	const enterRowEdit = (row: SidebarRow) => {
		if (row.kind === "file" && onRenameFile)
			beginRename({ kind: "file", path: row.file.path }, row.label);
		else if (row.kind === "folder" && onRenameFolder)
			beginRename(
				{
					kind: "folder",
					path: row.id,
					displayPath: folderDisplayPath(row),
					parentDisplayPath: folderRenameParentDisplayPath(row),
				},
				row.label,
			);
		else if (row.kind === "section") return;
		else activateRow(row);
	};
	const expandRow = (row: SidebarRow) => {
		if (row.kind === "folder") expandFolder(row.id);
	};
	const collapseRow = (row: SidebarRow) => {
		if (row.kind === "folder") collapseFolder(row.id);
	};
	const activeIndex = rows.findIndex(
		(row) => row.kind === "file" && row.file.path === highlightPath,
	);
	const { focusedIndex, setFocusedIndex, onKeyDown } = useSidebarKeyboardNav({
		items: rows,
		onSelect: activateRow,
		onEnter: enterRowEdit,
		onExpand: expandRow,
		onCollapse: collapseRow,
		navRef,
		activeIndex,
	});
	const handleDeleteSelection = (targetSelection: SidebarActionSelection) => {
		const actionable = sidebarDeleteSelection(
			targetSelection,
			getDisplayPath,
			Boolean(onDeleteFile),
			Boolean(onDeleteFolder),
		);
		if (actionable.count === 0) return;
		if (
			!window.confirm(
				`Delete ${actionable.count} ${actionable.count === 1 ? "item" : "items"}?`,
			)
		)
			return;
		for (const file of actionable.files) onDeleteFile?.(file.path);
		for (const folderId of actionable.folders) onDeleteFolder?.(folderId);
	};
	const handleTreeKeyDown = (event: React.KeyboardEvent) => {
		if (
			!isEditableEventTarget(event.target) &&
			keymatch(event.nativeEvent, "CmdOrCtrl+Backspace")
		) {
			const focusedRow = focusedIndex === null ? null : rows[focusedIndex];
			const focusedKey = focusedRow ? sidebarRowKey(focusedRow) : null;
			const activeKey = sidebarRowKey(rows[activeIndex]);
			const keys = focusedKey
				? selectedKeys.has(focusedKey)
					? selectedKeys
					: new Set([focusedKey])
				: selectedKeys.size > 0
					? selectedKeys
					: activeKey
						? new Set([activeKey])
						: selectedKeys;
			if (keys.size > 0) {
				event.preventDefault();
				handleDeleteSelection(sidebarActionSelection(rows, keys));
				return;
			}
		}
		onKeyDown(event);
	};
	useEffect(() => {
		const row = focusedIndex === null ? null : rows[focusedIndex];
		if (!row || row.kind === "section") {
			onFocusedItemChange?.(null);
			return;
		}
		onFocusedItemChange?.(
			row.kind === "file"
				? { kind: "file", path: row.file.path }
				: { kind: "folder", folderId: row.id },
		);
	}, [focusedIndex, onFocusedItemChange, rows]);

	useEffect(() => {
		if (!pendingFocusDisplayPath) return;
		const index = rows.findIndex(
			(row) =>
				row.kind === "file" &&
				normalizeDisplayPath(getDisplayPath(row.file.path)) ===
					pendingFocusDisplayPath,
		);
		if (index < 0) return;
		setFocusedIndex(index);
		setPendingFocusDisplayPath(null);
	}, [getDisplayPath, pendingFocusDisplayPath, rows, setFocusedIndex]);

	useEffect(() => {
		setSelection((current) => pruneSidebarSelection(current, rows));
	}, [rows]);

	useEffect(() => {
		setSelection((current) => snapSidebarSelection(current, highlightPath));
	}, [highlightPath]);

	const handleDragStart = (event: DragStartEvent) => {
		const data = event.active.data.current as DragItemData | undefined;
		setActiveDragLabel(data?.label ?? null);
		setActiveDragKeys(
			data
				? new Set(selectedKeys.has(data.key) ? selectedKeys : [data.key])
				: new Set(),
		);
	};
	const handleDragEnd = (event: DragEndEvent) => {
		setActiveDragLabel(null);
		setActiveDragKeys(new Set());
		setDropTarget(null);
		if (!onMoveItem || !event.over) return;
		const item = event.active.data.current as DragItemData | undefined;
		const target = event.over.data.current as DropTargetData | undefined;
		if (!item || !target) return;
		const targetFolderId = target.folderId;
		const items = sidebarMoveItemsForDrag({
			draggedItem: item,
			getDisplayPath,
			rows,
			selectedKeys,
			targetFolderId,
		});
		if (items.length === 0) return;
		void onMoveItem({
			items,
			targetFolderId,
		});
		setSelection({ selectedKeys: new Set(), anchorKey: null });
	};
	const handleDragOver = (event: DragOverEvent) => {
		const target = event.over?.data.current as DropTargetData | undefined;
		setDropTarget(
			event.over
				? { id: String(event.over.id), folderId: target?.folderId ?? null }
				: null,
		);
	};

	useEffect(() => {
		if (!activeDragLabel || !dropTarget?.folderId) return;
		const targetRow = rows.find(
			(row): row is Extract<SidebarRow, { kind: "folder" }> =>
				row.kind === "folder" &&
				!row.expanded &&
				(row.id === dropTarget.folderId ||
					row.segments.some((segment) => segment.id === dropTarget.folderId)),
		);
		if (!targetRow) return;
		// Let users hover a collapsed folder while dragging to reveal nested targets.
		const timer = window.setTimeout(() => {
			expandFolder(targetRow.id);
		}, DRAG_EXPAND_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [activeDragLabel, dropTarget, expandFolder, rows]);

	useEffect(() => {
		if (!renamingItem) return;
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [renamingItem]);

	useEffect(() => {
		const navEl = navRef.current;
		if (!navEl) {
			setShowFooterBorder(false);
			return;
		}
		const update = () => {
			setShowFooterBorder(shouldShowFooterDivider(navEl));
		};
		update();
		const observer = new MutationObserver(() => update());
		navEl.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		observer.observe(navEl, {
			childList: true,
			subtree: true,
		});
		return () => {
			navEl.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
			observer.disconnect();
		};
	}, []);

	const resetRename = () => {
		setRenamingItem(null);
		setRenameDraft("");
		setDeleteOnCancel(null);
		setRenameError(null);
	};

	const cancelRename = () => {
		const shouldDelete =
			deleteOnCancel &&
			renamingItem &&
			deleteOnCancel.kind === renamingItem.kind &&
			deleteOnCancel.path === renamingItem.path &&
			deleteOnCancel.draft === renameDraft;
		if (shouldDelete) {
			if (deleteOnCancel.kind === "file" && onDeleteFile)
				onDeleteFile(deleteOnCancel.path);
			else if (deleteOnCancel.kind === "folder" && onDeleteFolder)
				onDeleteFolder(deleteOnCancel.path);
		}
		resetRename();
	};

	const getRenameError = (item: RenameItem, draft: string) => {
		const nextName = draft.trim();
		if (!nextName) return null;
		const targetName = renameTargetName(item, nextName, getDisplayPath);
		if (!renameTargetExists(item, nextName, files, folders, getDisplayPath)) {
			return null;
		}
		return `A ${item.kind} ${targetName} already exists at this location.`;
	};

	const commitRename = (focusTree = false) => {
		const item = renamingItem;
		if (!item) return;
		const nextName = renameDraft.trim();
		if (!nextName) {
			resetRename();
			if (focusTree) requestAnimationFrame(() => navRef.current?.focus());
			return;
		}
		const error = getRenameError(item, nextName);
		if (error) {
			setRenameError(error);
			requestAnimationFrame(() => renameInputRef.current?.focus());
			return;
		}
		if (focusTree) {
			setPendingFocusDisplayPath(
				renameTargetDisplayPath(item, nextName, getDisplayPath),
			);
			requestAnimationFrame(() => navRef.current?.focus());
		}
		resetRename();
		if (item.kind === "file") onRenameFile?.(item.path, nextName);
		else
			onRenameFolder?.(
				item.path,
				nextName,
				renameTargetDisplayPath(item, nextName, getDisplayPath),
			);
	};

	const tree = (
		<DndContext
			collisionDetection={segmentFirstCollision}
			sensors={sensors}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragEnd={handleDragEnd}
			onDragCancel={() => {
				setActiveDragLabel(null);
				setActiveDragKeys(new Set());
				setDropTarget(null);
			}}
		>
			<DroppableSidebarNav
				ref={navRef}
				enabled={Boolean(onMoveItem)}
				onKeyDown={handleTreeKeyDown}
			>
				{rows.length === 0 && emptyState}
				{rows.map((row, index) => {
					const isActive =
						row.kind === "file" && row.file.path === highlightPath;
					const isFocused = focusedIndex === index;
					const rowKey = sidebarRowKey(row);
					const isSelected = rowKey ? selectedKeys.has(rowKey) : false;
					const actionSelection =
						rowKey && isSelected
							? sidebarActionSelection(rows, selectedKeys)
							: sidebarActionSelection(
									rows,
									rowKey ? new Set([rowKey]) : new Set(),
								);
					const isRenaming =
						(row.kind === "file" &&
							renamingItem?.kind === "file" &&
							row.file.path === renamingItem.path) ||
						(row.kind === "folder" &&
							renamingItem?.kind === "folder" &&
							row.id === renamingItem.path);
					const isPinnedFile = row.kind === "file" && row.file.pinned;
					const canTogglePinnedFile = isPinnedFile && onTogglePinnedFile;
					const isPinnedSectionEnd =
						isPinnedFile && rows[index + 1]?.kind !== "file";
					if (row.kind === "section") {
						return (
							<div
								key={row.id}
								role="presentation"
								data-sidebar-index={index}
								className="flex items-center gap-1 px-2 pb-1 pt-2 text-[10px] font-medium uppercase text-muted-foreground"
							>
								<MingcutePinFill className="size-3 shrink-0" />
								{row.label}
							</div>
						);
					}
					const rowStyle = {
						paddingInlineStart: `${0.5 + row.depth * 0.75}rem`,
					} as React.CSSProperties;
					const chevron = (
						<span className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground">
							{row.kind === "folder" && (
								<MingcuteRightLine
									className={cn(
										"size-3 transition-transform duration-150 ease-out",
										row.expanded && "rotate-90",
									)}
								/>
							)}
						</span>
					);
					const dropGroup = dropTarget
						? rowDropGroup({
								target: dropTarget,
								getDisplayPath,
								index,
								rows,
							})
						: null;
					const selectionGroup =
						isSelected && !dropGroup
							? rowSelectionGroup({ index, rows, selectedKeys })
							: null;
					return (
						<DraggableSidebarRow
							key={row.kind === "folder" ? row.id : row.file.path}
							enabled={Boolean(onMoveItem) && !isRenaming}
							row={row}
							getDisplayPath={getDisplayPath}
						>
							{({ attributes, isDragging, listeners, setNodeRef }) => (
								<div
									ref={setNodeRef}
									role="treeitem"
									tabIndex={-1}
									data-sidebar-index={index}
									aria-expanded={
										row.kind === "folder" ? row.expanded : undefined
									}
									aria-selected={isSelected || isActive}
									data-selected={isSelected ? "true" : undefined}
									className={cn(
										"group/sidebar-row relative flex w-full items-center text-sidebar-foreground",
										!isActive &&
											isSelected &&
											"bg-selected text-selected-foreground",
										!isActive && !isSelected && isFocused && "bg-accent",
										isActive &&
											"bg-sidebar-accent text-sidebar-accent-foreground font-medium",
										dropGroup
											? [
													"bg-sidebar-accent/40",
													dropGroup.start &&
														"rounded-se-[var(--radius-row)] rounded-ss-[var(--radius-row)]",
													dropGroup.end &&
														"rounded-ee-[var(--radius-row)] rounded-es-[var(--radius-row)]",
												]
											: // Round only the outer corners of a contiguous
												// multi-select run so adjacent rows look like one block
												selectionGroup
												? [
														selectionGroup.start &&
															"rounded-se-[var(--radius-row)] rounded-ss-[var(--radius-row)]",
														selectionGroup.end &&
															"rounded-ee-[var(--radius-row)] rounded-es-[var(--radius-row)]",
													]
												: "rounded-[var(--radius-row)]",
										isRenaming && "relative z-30",
										isPinnedSectionEnd && "mb-3",
										rowKey &&
											activeDragKeys.has(rowKey) &&
											!dropGroup &&
											"grayscale",
										isDragging && "opacity-50",
									)}
									onPointerEnter={() => setFocusedIndex(index)}
									onPointerLeave={() => setFocusedIndex(null)}
									onContextMenu={(event) => {
										if (
											row.kind === "file" &&
											!onRevealFile &&
											!onCopyFilePath &&
											!onRenameFile &&
											!onDeleteFile
										)
											return;
										if (
											row.kind === "folder" &&
											!onRevealFolder &&
											!onCreateFolder &&
											!onRenameFolder &&
											!onCreateFile &&
											!onDeleteFolder
										)
											return;
										event.preventDefault();
										if (!isSelected) replaceSelection(row);
										setOpenActionsPath(
											row.kind === "file" ? row.file.path : row.id,
										);
									}}
									title={row.label}
								>
									{isRenaming ? (
										<div
											className={cn(sidebarRowContentClass, "overflow-visible")}
											style={rowStyle}
										>
											{chevron}
											<FileRenameInput
												ref={renameInputRef}
												value={renameDraft}
												error={renameError}
												onChange={(value) => {
													setRenameDraft(value);
													setRenameError(
														row.kind === "file"
															? getRenameError(
																	{ kind: "file", path: row.file.path },
																	value,
																)
															: getRenameError(
																	{
																		kind: "folder",
																		path: row.id,
																		displayPath: folderDisplayPath(row),
																		parentDisplayPath:
																			folderRenameParentDisplayPath(row),
																	},
																	value,
																),
													);
												}}
												onCancel={cancelRename}
												onCommit={commitRename}
											/>
										</div>
									) : (
										<DroppableRowButton
											row={row}
											getDisplayPath={getDisplayPath}
											enabled={Boolean(onMoveItem)}
											className={cn(
												sidebarRowContentClass,
												"truncate border-none bg-transparent",
											)}
											style={rowStyle}
											onClick={(event) => handleRowClick(row, event)}
											onDoubleClick={(event) => {
												if (row.kind !== "file" || !onRenameFile) return;
												event.preventDefault();
												beginRename(
													{ kind: "file", path: row.file.path },
													row.label,
												);
											}}
											dragAttributes={attributes}
											dragListeners={listeners}
										>
											{chevron}
											{row.kind === "folder" ? (
												<FolderSegmentLabel
													dropTarget={dropTarget}
													row={row}
													enabled={Boolean(onMoveItem)}
												/>
											) : (
												<span
													className={cn(
														"min-w-0 flex-1 truncate",
														isPinnedFile && "[direction:rtl] [text-align:left]",
													)}
												>
													{row.label}
												</span>
											)}
										</DroppableRowButton>
									)}
									{canTogglePinnedFile && (
										<span
											className={cn(
												"pointer-events-none absolute inset-y-0 end-0 w-16 rounded-e-[var(--radius-row)] opacity-0 transition-opacity group-hover/sidebar-row:opacity-100",
												isActive
													? "bg-linear-to-r from-transparent from-0% via-sidebar-accent via-25% to-sidebar-accent"
													: isSelected
														? "bg-linear-to-r from-transparent from-0% via-selected via-25% to-selected"
														: "bg-linear-to-r from-transparent from-0% via-accent via-25% to-accent",
											)}
										/>
									)}
									<div className="absolute inset-y-0 end-0.5 flex items-center gap-0.5">
										{row.kind === "folder" &&
											(onRevealFolder ||
												onCreateFile ||
												onCreateFolder ||
												onRenameFolder ||
												onDeleteFolder) && (
												<FolderActionsMenu
													id={row.id}
													label={row.label}
													open={openActionsPath === row.id}
													onOpenChange={(open) =>
														setOpenActionsPath(open ? row.id : null)
													}
													onRevealFolder={onRevealFolder}
													revealLabel={revealLabel}
													onCreateFile={(id) => void createFile(id)}
													onCreateHtmlFile={
														onCreateHtmlFile
															? (id) => void createHtmlFile(id)
															: undefined
													}
													onCreateFolder={(id) => void createFolder(id)}
													onRenameFolder={
														onRenameFolder
															? (id, label) =>
																	beginRename(
																		{
																			kind: "folder",
																			path: id,
																			displayPath: folderDisplayPath(row),
																			parentDisplayPath:
																				folderRenameParentDisplayPath(row),
																		},
																		label,
																	)
															: undefined
													}
													onDeleteFolder={onDeleteFolder}
													selection={actionSelection}
													onDeleteFiles={onDeleteFile}
													onTogglePinnedFile={onTogglePinnedFile}
													getDisplayPath={getDisplayPath}
												/>
											)}
										{canTogglePinnedFile && (
											<button
												type="button"
												className={sidebarRowActionButtonClass}
												aria-label="Unpin"
												title="Unpin"
												onClick={(event) => {
													event.stopPropagation();
													onTogglePinnedFile(row.file.path);
												}}
											>
												<MingcutePinFill className="size-3.5" />
											</button>
										)}
										{row.kind === "file" &&
											(onRevealFile ||
												onCopyFilePath ||
												onRenameFile ||
												onDeleteFile ||
												onTogglePinnedFile) && (
												<FileActionsMenu
													file={row.file}
													label={row.label}
													open={openActionsPath === row.file.path}
													onOpenChange={(open) =>
														setOpenActionsPath(open ? row.file.path : null)
													}
													onRevealFile={onRevealFile}
													onCopyFilePath={onCopyFilePath}
													revealLabel={revealLabel}
													onRenameFile={(file, label) =>
														beginRename(
															{ kind: "file", path: file.path },
															label,
														)
													}
													onTogglePinnedFile={onTogglePinnedFile}
													onDeleteFile={onDeleteFile}
													selection={actionSelection}
													onDeleteFolders={onDeleteFolder}
													getDisplayPath={getDisplayPath}
												/>
											)}
									</div>
								</div>
							)}
						</DraggableSidebarRow>
					);
				})}
			</DroppableSidebarNav>
			<DragOverlay
				dropAnimation={null}
				modifiers={[alignChipToCursor]}
				style={{ pointerEvents: "none", width: "max-content" }}
			>
				{activeDragLabel ? (
					<div className="inline-flex w-max max-w-48 truncate rounded-sm border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[10px] text-sidebar-foreground shadow-overlay">
						{fileNameFromPath(activeDragLabel)}
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);

	return (
		<SidebarFrame onCollapse={onCollapse} storageScope={storageScope}>
			<div className="flex items-center justify-between border-b border-sidebar-border px-2.5 py-1.5">
				{header ?? (
					<span className="text-[11px] font-medium uppercase text-muted-foreground">
						Files
					</span>
				)}
				<div className="flex items-center gap-1">
					{onCreateFile && (
						<NewFileMenu
							onCreateFile={() => void createFile(null)}
							onCreateHtmlFile={
								onCreateHtmlFile ? () => void createHtmlFile(null) : undefined
							}
						/>
					)}
					{onCreateFolder && (
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="New folder"
							title="New folder"
							onClick={() => void createFolder(null)}
						>
							<MingcuteNewFolderLine className="size-3.5" />
						</Button>
					)}
					<Select.Root
						value={sortMode}
						onValueChange={(mode) => {
							if (mode) onSortModeChange(mode);
						}}
					>
						<Select.Trigger
							render={
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Sort by..."
									title="Sort by..."
								/>
							}
						>
							{sortMode === "alpha" ? (
								<MingcuteAzSortAscendingLettersLine className="size-3.5" />
							) : (
								<MingcuteSortDescendingLine className="size-3.5" />
							)}
						</Select.Trigger>
						<Select.Portal>
							<Select.Positioner
								align="end"
								side="bottom"
								sideOffset={4}
								className="isolate z-50"
							>
								<Select.Popup className="z-50 w-36 origin-(--transform-origin) rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
									<p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
										Sort by
									</p>
									<SortOption value="recent" label="Recent" />
									<SortOption value="alpha" label="Name" />
								</Select.Popup>
							</Select.Positioner>
						</Select.Portal>
					</Select.Root>
				</div>
			</div>
			{tree}
			{footer ? (
				<div
					className={cn(
						"p-2",
						showFooterBorder
							? "[border-block-start:1px_dashed_var(--sidebar-border)]"
							: "border-transparent",
					)}
				>
					{footer}
				</div>
			) : null}
		</SidebarFrame>
	);
}

type DragItemData = SidebarMoveCandidate & { label: string };

type DropTargetData = {
	folderId: string | null;
};

type DropTarget = DropTargetData & {
	id: string;
};

type DragRenderProps = ReturnType<typeof useDraggable> & {
	isDragging: boolean;
};

function DraggableSidebarRow({
	children,
	enabled,
	getDisplayPath,
	row,
}: {
	children: (props: DragRenderProps) => ReactNode;
	enabled: boolean;
	getDisplayPath: (path: string) => string;
	row: Extract<SidebarRow, { kind: "file" | "folder" }>;
}) {
	const candidate = sidebarMoveCandidateFromRow(
		row,
		getDisplayPath,
	) as SidebarMoveCandidate;
	const data = { ...candidate, label: row.label } satisfies DragItemData;
	const draggable = useDraggable({
		id: `sidebar-drag:${row.kind}:${row.kind === "file" ? row.file.path : row.id}`,
		data,
		disabled: !enabled,
	});
	return children(draggable);
}

const DroppableSidebarNav = forwardRef<
	HTMLDivElement,
	{
		children: ReactNode;
		enabled: boolean;
		onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
	}
>(function DroppableSidebarNav({ children, enabled, onKeyDown }, ref) {
	const { setNodeRef } = useDroppable({
		id: "sidebar-drop:root",
		data: { folderId: null } satisfies DropTargetData,
		disabled: !enabled,
	});
	const setRefs = (node: HTMLDivElement | null) => {
		setNodeRef(node);
		if (typeof ref === "function") ref(node);
		else if (ref) ref.current = node;
	};
	return (
		<div
			ref={setRefs}
			role="tree"
			className="flex-1 overflow-y-auto overscroll-contain px-1.5 py-1 outline-none"
			tabIndex={0}
			onKeyDown={onKeyDown}
			data-sidebar-nav
		>
			{children}
		</div>
	);
});

function DroppableRowButton({
	children,
	className,
	dragAttributes,
	dragListeners,
	enabled,
	getDisplayPath,
	onClick,
	onDoubleClick,
	row,
	style,
}: {
	children: ReactNode;
	className: string;
	dragAttributes: ReturnType<typeof useDraggable>["attributes"];
	dragListeners: ReturnType<typeof useDraggable>["listeners"];
	enabled: boolean;
	getDisplayPath: (path: string) => string;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	row: Extract<SidebarRow, { kind: "file" | "folder" }>;
	style: React.CSSProperties;
}) {
	const folderId =
		row.kind === "folder"
			? row.id
			: folderIdFromDisplayPath(getDisplayPath(row.file.path));
	const { setNodeRef } = useDroppable({
		id: `sidebar-drop:row:${row.kind === "folder" ? row.id : row.file.path}`,
		data: { folderId } satisfies DropTargetData,
		disabled: !enabled,
	});
	return (
		<button
			ref={setNodeRef}
			type="button"
			className={className}
			style={style}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			{...dragAttributes}
			{...dragListeners}
		>
			{children}
		</button>
	);
}

function FolderSegmentLabel({
	enabled,
	dropTarget,
	row,
}: {
	enabled: boolean;
	dropTarget: DropTarget | null;
	row: Extract<SidebarRow, { kind: "folder" }>;
}) {
	return (
		<span className="flex min-w-0 flex-1 truncate">
			{row.segments.map((segment, index) => (
				<FolderSegment
					active={isActiveSegmentDrop(dropTarget, segment.id)}
					key={segment.id}
					enabled={enabled}
					segment={segment}
					separator={index > 0}
				/>
			))}
		</span>
	);
}

function FolderSegment({
	active,
	enabled,
	segment,
	separator,
}: {
	active: boolean;
	enabled: boolean;
	segment: { id: string; name: string };
	separator: boolean;
}) {
	const {
		attributes,
		listeners,
		setNodeRef: setDragRef,
	} = useDraggable({
		id: `sidebar-drag:segment:${segment.id}`,
		data: {
			kind: "folder",
			folderId: segment.id,
			key: `folder:${segment.id}`,
			parentFolderId: parentFolderId(segment.id),
			label: segment.name,
		} satisfies DragItemData,
		disabled: !enabled,
	});
	const { setNodeRef } = useDroppable({
		id: `sidebar-drop:segment:${segment.id}`,
		data: { folderId: segment.id } satisfies DropTargetData,
		disabled: !enabled,
	});
	const setRefs = (node: HTMLSpanElement | null) => {
		setDragRef(node);
		setNodeRef(node);
	};
	return (
		<>
			{separator ? <span className="text-muted-foreground">/</span> : null}
			<span
				ref={setRefs}
				className={cn(
					"min-w-0 truncate rounded-sm",
					active && "bg-sidebar-accent/70",
				)}
				{...attributes}
				{...listeners}
			>
				{segment.name}
			</span>
		</>
	);
}

function isActiveSegmentDrop(target: DropTarget | null, segmentId: string) {
	return target?.folderId === segmentId && target.id.startsWith(SEGMENT_DROP);
}

function folderIdFromDisplayPath(displayPath: string): string | null {
	const dir = dirname(normalizeDisplayPath(displayPath));
	return dir ? `${normalizeDisplayPath(dir)}/` : null;
}

function parentFolderId(folderId: string): string | null {
	const normalized = folderId.replace(/\/+$/, "");
	const parent = dirname(normalized);
	return parent ? `${normalizeDisplayPath(parent)}/` : null;
}

function folderDisplayPath(row: Extract<SidebarRow, { kind: "folder" }>) {
	const firstSegmentId = row.segments[0]?.id ?? row.id;
	const parent = parentFolderId(firstSegmentId);
	return normalizeDisplayPath(parent ? `${parent}${row.label}` : row.label);
}

function folderRenameParentDisplayPath(
	row: Extract<SidebarRow, { kind: "folder" }>,
) {
	const firstSegmentId = row.segments[0]?.id ?? row.id;
	const parent = parentFolderId(firstSegmentId);
	return parent ? normalizeDisplayPath(parent).replace(/\/+$/, "") : "";
}

function rowDropGroup({
	getDisplayPath,
	index,
	rows,
	target,
}: {
	getDisplayPath: (path: string) => string;
	index: number;
	rows: SidebarRow[];
	target: DropTarget;
}) {
	const row = rows[index];
	if (!row || row.kind === "section") return null;
	if (
		target.id.startsWith(SEGMENT_DROP) &&
		row.kind === "folder" &&
		row.segments.some((segment) => segment.id === target.folderId)
	) {
		return null;
	}
	if (!rowInFolderDropTarget(row, target.folderId, getDisplayPath)) return null;

	const previous = previousSidebarItem(rows, index);
	const next = nextSidebarItem(rows, index);
	return {
		start:
			!previous ||
			!rowInFolderDropTarget(previous, target.folderId, getDisplayPath),
		end: !next || !rowInFolderDropTarget(next, target.folderId, getDisplayPath),
	};
}

function rowSelectionGroup({
	index,
	rows,
	selectedKeys,
}: {
	index: number;
	rows: SidebarRow[];
	selectedKeys: Set<string>;
}) {
	const inSelection = (row: SidebarRow | null) => {
		const key = row ? sidebarRowKey(row) : null;
		return key ? selectedKeys.has(key) : false;
	};
	if (!inSelection(rows[index])) return null;
	return {
		start: !inSelection(previousSidebarItem(rows, index)),
		end: !inSelection(nextSidebarItem(rows, index)),
	};
}

function sidebarActionSelection(
	rows: SidebarRow[],
	selectedKeys: Set<string>,
): SidebarActionSelection {
	const files: SidebarFile[] = [];
	const folders: string[] = [];
	for (const row of rows) {
		const key = sidebarRowKey(row);
		if (!key || !selectedKeys.has(key)) continue;
		if (row.kind === "file") files.push(row.file);
		else if (row.kind === "folder") folders.push(row.id);
	}
	return { files, folders, count: files.length + folders.length };
}

export function sidebarDeleteSelection(
	selection: SidebarActionSelection,
	getDisplayPath: (path: string) => string,
	canDeleteFiles: boolean,
	canDeleteFolders: boolean,
): SidebarActionSelection {
	// Deleting a folder already removes its descendants; issuing both operations can race.
	const folders = canDeleteFolders
		? selection.folders.filter(
				(folderId) =>
					!selection.folders.some(
						(ancestorId) =>
							ancestorId !== folderId && folderId.startsWith(ancestorId),
					),
			)
		: [];
	const files = canDeleteFiles
		? selection.files.filter((file) => {
				const displayPath = normalizeDisplayPath(getDisplayPath(file.path));
				return !folders.some((folderId) => displayPath.startsWith(folderId));
			})
		: [];
	return { files, folders, count: files.length + folders.length };
}

function previousSidebarItem(rows: SidebarRow[], index: number) {
	for (let cursor = index - 1; cursor >= 0; cursor--) {
		const row = rows[cursor];
		if (row?.kind !== "section") return row;
	}
	return null;
}

function nextSidebarItem(rows: SidebarRow[], index: number) {
	for (let cursor = index + 1; cursor < rows.length; cursor++) {
		const row = rows[cursor];
		if (row?.kind !== "section") return row;
	}
	return null;
}

function rowInFolderDropTarget(
	row: Extract<SidebarRow, { kind: "file" | "folder" }>,
	folderId: string | null,
	getDisplayPath: (path: string) => string,
) {
	if (folderId === null) return true;
	if (row.kind === "file") {
		const parent = folderIdFromDisplayPath(getDisplayPath(row.file.path));
		return parent === folderId || Boolean(parent?.startsWith(folderId));
	}
	return row.id === folderId || row.id.startsWith(folderId);
}

function isInvalidMove(
	item: SidebarMoveCandidate,
	targetFolderId: string | null,
) {
	if (item.parentFolderId === targetFolderId) return true;
	if (item.kind === "file") return false;
	if (item.folderId === targetFolderId) return true;
	if (!targetFolderId) return false;
	return targetFolderId.startsWith(item.folderId);
}

export function SidebarFrame({
	children,
	onCollapse,
	storageScope,
}: {
	children: ReactNode;
	onCollapse?: () => void;
	storageScope?: string | null;
}) {
	const asideRef = useRef<HTMLElement | null>(null);
	const widthStorageKey = sidebarWidthStorageKey(storageScope);
	const [sidebarWidth, setSidebarWidth] = useState(() =>
		readSidebarWidth(widthStorageKey),
	);
	const sidebarWidthRef = useRef(sidebarWidth);
	const previewCollapsedRef = useRef(false);
	const [previewCollapsed, setPreviewCollapsedState] = useState(false);

	useEffect(() => {
		const nextWidth = readSidebarWidth(widthStorageKey);
		sidebarWidthRef.current = nextWidth;
		setSidebarWidth(nextWidth);
	}, [widthStorageKey]);

	// Publish width on the document root so the full-window toolbar (a sibling,
	// not a descendant) can match the sidebar seam. Hoisting the variable onto a
	// shared ancestor would mean lifting width state (resize + persistence) out
	// of this component into a provider both app shells wire up. One sidebar
	// mounts per window and cleanup removes the property, so the root is safe.
	useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
		return () => {
			root.style.removeProperty("--sidebar-width");
		};
	}, [sidebarWidth]);

	function setWidth(nextWidth: number) {
		const clampedWidth = clampSidebarWidth(nextWidth);
		sidebarWidthRef.current = clampedWidth;
		setSidebarWidth(clampedWidth);
	}

	function setPreviewCollapsed(nextPreviewCollapsed: boolean) {
		if (previewCollapsedRef.current === nextPreviewCollapsed) return;
		previewCollapsedRef.current = nextPreviewCollapsed;
		setPreviewCollapsedState(nextPreviewCollapsed);
	}

	function commitResize() {
		const shouldCollapse = previewCollapsedRef.current;
		if (shouldCollapse && onCollapse) {
			onCollapse();
			return;
		}
		writeSidebarWidth(widthStorageKey, sidebarWidthRef.current);
	}

	const { isResizing, separatorProps } = useResizeSeparator({
		axis: "col",
		label: "Resize sidebar",
		value: sidebarWidth,
		min: MIN_SIDEBAR_WIDTH,
		max: MAX_SIDEBAR_WIDTH,
		onChange: setWidth,
		targetRef: asideRef,
		onResizeStart: () => {
			setPreviewCollapsed(false);
		},
		onResizeEnd: () => {
			setPreviewCollapsed(false);
		},
		onCommit: () => {
			commitResize();
			setPreviewCollapsed(false);
		},
		getPointerValue: ({ event, startRect }) => {
			if (onCollapse && event.clientX <= COLLAPSE_EDGE_DISTANCE) {
				setPreviewCollapsed(true);
				return null;
			}
			setPreviewCollapsed(false);
			return event.clientX - (startRect?.left ?? 0);
		},
	});

	return (
		<aside
			ref={asideRef}
			data-sidebar-root
			className={cn(
				"relative flex shrink-0 flex-col overflow-visible border-e border-sidebar-border bg-sidebar",
				isResizing && "select-none",
			)}
			style={
				{
					"--sidebar-width": `${sidebarWidth}px`,
					inlineSize: previewCollapsed ? 0 : sidebarWidth,
					maxInlineSize: MAX_SIDEBAR_WIDTH,
					minInlineSize: previewCollapsed ? 0 : MIN_SIDEBAR_WIDTH,
				} as CSSProperties & Record<"--sidebar-width", string>
			}
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{children}
			</div>
			<div
				className="group absolute z-20 cursor-col-resize outline-none [inset-block:0]"
				style={{
					inlineSize: RESIZE_HANDLE_WIDTH,
					insetInlineEnd: -(RESIZE_HANDLE_WIDTH / 2),
				}}
				// A resizable split pane maps to the ARIA separator pattern:
				// arrow keys resize, Home/End jump to min/max, and pointer drag works normally.
				{...separatorProps}
			>
				<span
					className={cn(
						"absolute bg-transparent [inset-block:0] [inset-inline-start:50%] [inline-size:1px] group-focus:bg-primary",
						isResizing && "bg-primary",
					)}
				/>
			</div>
		</aside>
	);
}

function NewFileMenu({
	onCreateFile,
	onCreateHtmlFile,
}: {
	onCreateFile: () => void;
	onCreateHtmlFile?: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Menu.Root open={open} onOpenChange={setOpen}>
			<Menu.Trigger
				render={
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="New file"
						title="New file"
					/>
				}
			>
				<MingcuteEditLine className="size-3.5" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner
					align="end"
					side="bottom"
					sideOffset={4}
					className="isolate z-50"
				>
					<Menu.Popup className="z-50 w-44 origin-(--transform-origin) rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						<ActionItem
							icon={<MingcuteEditLine />}
							onClick={onCreateFile}
							shortcut={formatShortcut("CmdOrCtrl+N")}
						>
							New Note
						</ActionItem>
						{onCreateHtmlFile && (
							<ActionItem
								icon={<MingcuteCodeLine />}
								onClick={onCreateHtmlFile}
							>
								New HTML App
							</ActionItem>
						)}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function FolderActionsMenu({
	id,
	label,
	open,
	onOpenChange,
	selection,
	onRevealFolder,
	revealLabel,
	onCreateFile,
	onCreateHtmlFile,
	onCreateFolder,
	onRenameFolder,
	onDeleteFolder,
	onDeleteFiles,
	onTogglePinnedFile,
	getDisplayPath,
}: {
	id: string;
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selection: SidebarActionSelection;
	onRevealFolder?: (id: string) => void;
	revealLabel?: string;
	onCreateFile?: (id: string) => void;
	onCreateHtmlFile?: (id: string) => void;
	onCreateFolder?: (id: string) => void;
	onRenameFolder?: (id: string, label: string) => void;
	onDeleteFolder?: (id: string) => void;
	onDeleteFiles?: (path: string) => void;
	onTogglePinnedFile?: (path: string) => void;
	getDisplayPath: (path: string) => string;
}) {
	if (selection.count > 1) {
		return (
			<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
				<BulkPinAction
					selection={selection}
					onTogglePinnedFile={onTogglePinnedFile}
				/>
				<BulkDeleteAction
					selection={selection}
					onDeleteFile={onDeleteFiles}
					onDeleteFolder={onDeleteFolder}
					getDisplayPath={getDisplayPath}
				/>
			</ActionsMenu>
		);
	}
	return (
		<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
			{onRevealFolder && (
				<ActionItem
					icon={<MingcuteFolderOpenLine />}
					onClick={() => onRevealFolder(id)}
					shortcut={formatShortcut("CmdOrCtrl+Alt+R")}
				>
					{revealLabel ?? "Reveal in File Manager"}
				</ActionItem>
			)}
			{onCreateFile && (
				<ActionItem
					icon={<MingcuteEditLine />}
					onClick={() => onCreateFile(id)}
					shortcut={formatShortcut("CmdOrCtrl+N")}
				>
					New file
				</ActionItem>
			)}
			{onCreateHtmlFile && (
				<ActionItem
					icon={<MingcuteCodeLine />}
					onClick={() => onCreateHtmlFile(id)}
				>
					New HTML App
				</ActionItem>
			)}
			{onCreateFolder && (
				<ActionItem
					icon={<MingcuteNewFolderLine />}
					onClick={() => onCreateFolder(id)}
				>
					New folder
				</ActionItem>
			)}
			{onRenameFolder && (
				<ActionItem
					icon={<MingcuteEditLine />}
					onClick={() => onRenameFolder(id, label)}
				>
					Rename
				</ActionItem>
			)}
			{onDeleteFolder && (
				<ActionItem
					destructive
					icon={<MingcuteDeleteLine />}
					shortcut={formatShortcut("CmdOrCtrl+Backspace")}
					onClick={() => {
						if (!window.confirm(`Delete ${label} and all its contents?`))
							return;
						onDeleteFolder(id);
					}}
				>
					Delete
				</ActionItem>
			)}
		</ActionsMenu>
	);
}

function FileActionsMenu({
	file,
	label,
	open,
	onOpenChange,
	selection,
	onRevealFile,
	onCopyFilePath,
	revealLabel,
	onRenameFile,
	onTogglePinnedFile,
	onDeleteFile,
	onDeleteFolders,
	getDisplayPath,
}: {
	file: SidebarFile;
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selection: SidebarActionSelection;
	onRevealFile?: (path: string) => void;
	onCopyFilePath?: (path: string) => void;
	revealLabel?: string;
	onRenameFile?: (file: SidebarFile, label: string) => void;
	onTogglePinnedFile?: (path: string) => void;
	onDeleteFile?: (path: string) => void;
	onDeleteFolders?: (id: string) => void;
	getDisplayPath: (path: string) => string;
}) {
	if (selection.count > 1) {
		return (
			<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
				<BulkPinAction
					selection={selection}
					onTogglePinnedFile={onTogglePinnedFile}
				/>
				<BulkDeleteAction
					selection={selection}
					onDeleteFile={onDeleteFile}
					onDeleteFolder={onDeleteFolders}
					getDisplayPath={getDisplayPath}
				/>
			</ActionsMenu>
		);
	}
	return (
		<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
			{onRevealFile && (
				<ActionItem
					icon={<MingcuteFolderOpenLine />}
					onClick={() => onRevealFile(file.path)}
					shortcut={formatShortcut("CmdOrCtrl+Alt+R")}
				>
					{revealLabel ?? "Reveal in File Manager"}
				</ActionItem>
			)}
			{onCopyFilePath && (
				<ActionItem
					icon={<MingcuteCopy2Line />}
					onClick={() => onCopyFilePath(file.path)}
					shortcut={formatShortcut("CmdOrCtrl+Shift+C")}
				>
					Copy file path
				</ActionItem>
			)}
			{onRenameFile && (
				<ActionItem
					icon={<MingcuteEditLine />}
					onClick={() => onRenameFile(file, label)}
				>
					Rename
				</ActionItem>
			)}
			{onTogglePinnedFile && (
				<ActionItem
					icon={<MingcutePinLine />}
					onClick={() => onTogglePinnedFile(file.path)}
				>
					{file.pinned ? "Unpin" : "Pin"}
				</ActionItem>
			)}
			{onDeleteFile && (
				<ActionItem
					destructive
					icon={<MingcuteDeleteLine />}
					shortcut={formatShortcut("CmdOrCtrl+Backspace")}
					onClick={() => {
						if (!window.confirm(`Delete ${label}?`)) return;
						onDeleteFile(file.path);
					}}
				>
					Delete
				</ActionItem>
			)}
		</ActionsMenu>
	);
}

function BulkPinAction({
	selection,
	onTogglePinnedFile,
}: {
	selection: SidebarActionSelection;
	onTogglePinnedFile?: (path: string) => void;
}) {
	if (!onTogglePinnedFile || selection.files.length === 0) return null;
	const pinning = selection.files.some((file) => !file.pinned);
	const filesToToggle = pinning
		? selection.files.filter((file) => !file.pinned)
		: selection.files;
	const count = selection.files.length;
	return (
		<ActionItem
			icon={<MingcutePinLine />}
			onClick={() => {
				for (const file of filesToToggle) onTogglePinnedFile(file.path);
			}}
		>
			{pinning ? "Pin" : "Unpin"} {count} {count === 1 ? "file" : "files"}
		</ActionItem>
	);
}

function BulkDeleteAction({
	selection,
	onDeleteFile,
	onDeleteFolder,
	getDisplayPath,
}: {
	selection: SidebarActionSelection;
	onDeleteFile?: (path: string) => void;
	onDeleteFolder?: (id: string) => void;
	getDisplayPath: (path: string) => string;
}) {
	const actionable = sidebarDeleteSelection(
		selection,
		getDisplayPath,
		Boolean(onDeleteFile),
		Boolean(onDeleteFolder),
	);
	if (actionable.count === 0) return null;
	return (
		<ActionItem
			destructive
			icon={<MingcuteDeleteLine />}
			shortcut={formatShortcut("CmdOrCtrl+Backspace")}
			onClick={() => {
				if (
					!window.confirm(
						`Delete ${actionable.count} ${actionable.count === 1 ? "item" : "items"}?`,
					)
				)
					return;
				for (const file of actionable.files) onDeleteFile?.(file.path);
				for (const folderId of actionable.folders) onDeleteFolder?.(folderId);
			}}
		>
			Delete {actionable.count} {actionable.count === 1 ? "item" : "items"}
		</ActionItem>
	);
}

function ActionsMenu({
	label,
	open,
	onOpenChange,
	children,
}: {
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
}) {
	return (
		<Menu.Root open={open} onOpenChange={onOpenChange}>
			<Menu.Trigger
				render={
					<button
						type="button"
						className={sidebarRowActionButtonClass}
						aria-label={`Actions for ${label}`}
						title={`Actions for ${label}`}
						onContextMenu={(event) => {
							event.preventDefault();
							onOpenChange(true);
						}}
					/>
				}
			>
				<MingcuteMore2Line className="size-3.5" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner
					align="end"
					side="bottom"
					sideOffset={4}
					className="isolate z-50"
				>
					<Menu.Popup className="z-50 w-44 origin-(--transform-origin) rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						{children}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function ActionItem({
	children,
	destructive,
	icon,
	onClick,
	shortcut,
}: {
	children: React.ReactNode;
	destructive?: boolean;
	icon: React.ReactNode;
	onClick: () => void;
	shortcut?: string;
}) {
	return (
		<Menu.Item
			className={cn(
				sidebarActionClass,
				"cursor-pointer data-highlighted:bg-accent",
				destructive && "text-destructive",
			)}
			onClick={onClick}
		>
			<span className={sidebarActionIconClass}>{icon}</span>
			<span className="min-w-0 flex-1">{children}</span>
			{shortcut ? <ShortcutHint>{shortcut}</ShortcutHint> : null}
		</Menu.Item>
	);
}

function ShortcutHint({ children }: { children: string }) {
	return (
		<span
			className="ms-auto shrink-0 text-[11px] leading-none text-muted-foreground/60"
			aria-hidden="true"
		>
			{children}
		</span>
	);
}

function FileRenameInput({
	ref,
	value,
	error,
	onChange,
	onCancel,
	onCommit,
}: {
	ref: React.Ref<HTMLInputElement>;
	value: string;
	error: string | null;
	onChange: (value: string) => void;
	onCancel: () => void;
	onCommit: (focusTree?: boolean) => void;
}) {
	return (
		<span className="relative flex min-w-0 flex-1 items-center">
			<input
				ref={ref}
				aria-invalid={error ? true : undefined}
				className="min-w-0 flex-1 rounded-none border-0 bg-muted/70 p-0 text-[13px] text-sidebar-foreground outline-none selection:bg-selected/70 selection:text-sidebar-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
				value={value}
				onBlur={() => onCommit()}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onCommit(true);
					} else if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
			/>
			{error && (
				<span className="absolute top-full start-0 z-20 mt-1 w-max max-w-[calc(var(--sidebar-width)-2rem)] rounded-sm bg-[oklch(0.78_0.11_4)] px-2 py-1.5 text-[11px] font-normal leading-4 text-[oklch(0.18_0.02_4)] shadow-overlay">
					{error}
				</span>
			)}
		</span>
	);
}

function clampSidebarWidth(width: number) {
	return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function sidebarWidthStorageKey(storageScope?: string | null) {
	return storageScope
		? `hubble-sidebar-width:${storageScope}`
		: "hubble-sidebar-width";
}

function readSidebarWidth(storageKey: string) {
	if (typeof localStorage === "undefined") return DEFAULT_SIDEBAR_WIDTH;
	try {
		const value = Number.parseInt(localStorage.getItem(storageKey) ?? "", 10);
		return Number.isFinite(value)
			? clampSidebarWidth(value)
			: DEFAULT_SIDEBAR_WIDTH;
	} catch {
		return DEFAULT_SIDEBAR_WIDTH;
	}
}

function writeSidebarWidth(storageKey: string, width: number) {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(storageKey, String(clampSidebarWidth(width)));
}

function renameTargetExists(
	item: RenameItem,
	nextName: string,
	files: SidebarFile[],
	folders: SidebarFolder[],
	getDisplayPath: (path: string) => string,
) {
	const targetDisplayPath = renameTargetDisplayPath(
		item,
		nextName,
		getDisplayPath,
	);
	const sourceDisplayPath = normalizeDisplayPath(
		item.kind === "folder" ? item.displayPath : getDisplayPath(item.path),
	).replace(/\/+$/, "");

	const fileExists = files.some((file) => {
		const displayPath = normalizeDisplayPath(getDisplayPath(file.path));
		if (item.kind === "file" && file.path === item.path) return false;
		return (
			displayPath.toLocaleLowerCase() === targetDisplayPath.toLocaleLowerCase()
		);
	});
	if (fileExists) return true;

	return folders.some((folder) => {
		const displayPath = normalizeDisplayPath(
			getDisplayPath(folder.path),
		).replace(/\/+$/, "");
		if (item.kind === "folder" && displayPath === sourceDisplayPath)
			return false;
		return (
			displayPath.toLocaleLowerCase() === targetDisplayPath.toLocaleLowerCase()
		);
	});
}

function renameTargetName(
	item: RenameItem,
	nextName: string,
	getDisplayPath: (path: string) => string,
) {
	return fileNameFromPath(
		renameTargetDisplayPath(item, nextName, getDisplayPath),
	);
}

function renameTargetDisplayPath(
	item: RenameItem,
	nextName: string,
	getDisplayPath: (path: string) => string,
) {
	const sourceDisplayPath = normalizeDisplayPath(
		item.kind === "folder" ? item.displayPath : getDisplayPath(item.path),
	).replace(/\/+$/, "");
	const sourceName = fileNameFromPath(sourceDisplayPath);
	const { extension } =
		item.kind === "file" ? splitFileName(sourceName) : { extension: "" };
	const parent =
		item.kind === "folder"
			? item.parentDisplayPath
			: dirname(sourceDisplayPath);
	const targetName = stripMatchingExtension(nextName.trim(), extension);
	return normalizeDisplayPath(
		parent
			? `${parent}/${targetName}${extension}`
			: `${targetName}${extension}`,
	);
}

function stripMatchingExtension(name: string, extension: string) {
	if (!extension) return name;
	return name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
		? name.slice(0, -extension.length)
		: name;
}

function SortOption({ value, label }: { value: string; label: string }) {
	return (
		<Select.Item
			value={value}
			className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-start text-[11px] text-foreground outline-hidden select-none data-highlighted:bg-accent"
		>
			<Select.ItemIndicator className="inline-flex" keepMounted>
				<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
			</Select.ItemIndicator>
			<Select.ItemText>{label}</Select.ItemText>
		</Select.Item>
	);
}
