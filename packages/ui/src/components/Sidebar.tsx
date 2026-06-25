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
import {
	type CSSProperties,
	forwardRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteAzSortAscendingLettersLine from "~icons/mingcute/az-sort-ascending-letters-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteDeleteLine from "~icons/mingcute/delete-line";
import MingcuteEditLine from "~icons/mingcute/edit-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import MingcutePinFill from "~icons/mingcute/pin-fill";
import MingcutePinLine from "~icons/mingcute/pin-line";
import MingcuteRightLine from "~icons/mingcute/right-line";
import MingcuteSortDescendingLine from "~icons/mingcute/sort-descending-line";
import {
	dirname,
	fileNameFromPath,
	normalizeDisplayPath,
	splitFileName,
} from "../lib/filePath";
import { shouldShowFooterDivider } from "../lib/scrollOverflow";
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

export type SidebarMoveItemInput = {
	item: { kind: "file"; path: string } | { kind: "folder"; folderId: string };
	targetFolderId: string | null;
};

export type SidebarFocusedItem =
	| { kind: "file"; path: string }
	| { kind: "folder"; folderId: string }
	| null;

type RenameTarget =
	| { kind: "file"; path: string }
	| { kind: "folder"; folderId: string };

const sidebarActionClass =
	"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-[11px] font-normal outline-hidden select-none";
const sidebarActionIconClass =
	"inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5";
const sidebarRowContentClass =
	"flex min-w-0 flex-1 items-center gap-1 [padding-block:var(--row-pad-block)] [padding-inline-end:1.25rem] text-start text-[length:var(--font-size-sidebar)]";
const sidebarRowActionButtonClass =
	"inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-transparent bg-transparent text-muted-foreground/70 opacity-0 outline-hidden transition-[opacity,color] hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40 group-hover/sidebar-row:opacity-100 aria-expanded:text-foreground aria-expanded:opacity-100";
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

export function Sidebar({
	files,
	folders,
	currentPath,
	pendingPath,
	sortMode,
	storageScope,
	header,
	footer,
	emptyState,
	getDisplayPath = (path) => path,
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
	onRenameFolder?: (folderId: string, nextName: string) => void;
	onDeleteFile?: (path: string) => void;
	onTogglePinnedFile?: (path: string) => void;
	onCreateFile?: (folderId: string | null) => Promise<string | null>;
	onDeleteFolder?: (folderId: string) => void;
	onMoveItem?: (input: SidebarMoveItemInput) => Promise<void> | void;
}) {
	const navRef = useRef<HTMLDivElement>(null);
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const [openActionsPath, setOpenActionsPath] = useState<string | null>(null);
	const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [showFooterBorder, setShowFooterBorder] = useState(false);
	const [deleteOnCancel, setDeleteOnCancel] = useState<{
		path: string;
		draft: string;
	} | null>(null);
	const [renameError, setRenameError] = useState<string | null>(null);
	const [pendingFocusDisplayPath, setPendingFocusDisplayPath] = useState<
		string | null
	>(null);
	const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const highlightPath = pendingPath ?? currentPath;
	const {
		collapseFolder,
		expandFolder,
		migrateExpandedFolder,
		rows,
		toggleFolder,
	} = useSidebarTree({
		files,
		folders,
		getDisplayPath,
		highlightPath,
		sortMode,
		storageScope,
	});
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);
	const beginRename = useCallback(
		(
			file: SidebarFile,
			label: string,
			options?: { deleteOnUnchangedCancel?: boolean },
		) => {
			const name = splitFileName(label).name;
			setOpenActionsPath(null);
			setRenameTarget({ kind: "file", path: file.path });
			setRenameDraft(name);
			setDeleteOnCancel(
				options?.deleteOnUnchangedCancel
					? { path: file.path, draft: name }
					: null,
			);
			setRenameError(null);
		},
		[],
	);
	const beginFolderRename = useCallback((folderId: string) => {
		const draft = folderId.replace(/\/+$/, "");
		setOpenActionsPath(null);
		setRenameTarget({ kind: "folder", folderId });
		setRenameDraft(draft);
		setDeleteOnCancel(null);
		setRenameError(null);
	}, []);
	const createFile = useCallback(
		async (folderId: string | null) => {
			if (!onCreateFile) return;
			setOpenActionsPath(null);
			if (folderId) expandFolder(folderId);
			const path = await onCreateFile(folderId);
			if (!path) return;
			beginRename({ path }, fileNameFromPath(getDisplayPath(path)), {
				deleteOnUnchangedCancel: true,
			});
		},
		[beginRename, expandFolder, getDisplayPath, onCreateFile],
	);
	const activateRow = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "file") onSelectFile(row.file.path);
			else if (row.kind === "folder") toggleFolder(row.id);
		},
		[onSelectFile, toggleFolder],
	);
	const enterRowEdit = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "file" && onRenameFile) beginRename(row.file, row.label);
			else if (row.kind === "folder" && onRenameFolder)
				beginFolderRename(row.id);
			else if (row.kind === "section") return;
			else activateRow(row);
		},
		[activateRow, beginFolderRename, beginRename, onRenameFile, onRenameFolder],
	);
	const expandRow = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "folder") expandFolder(row.id);
		},
		[expandFolder],
	);
	const collapseRow = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "folder") collapseFolder(row.id);
		},
		[collapseFolder],
	);
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
				(row.kind === "file" &&
					normalizeDisplayPath(getDisplayPath(row.file.path)) ===
						pendingFocusDisplayPath) ||
				(row.kind === "folder" &&
					folderIdToComparableDisplayPath(row.id) === pendingFocusDisplayPath),
		);
		if (index < 0) return;
		setFocusedIndex(index);
		setPendingFocusDisplayPath(null);
	}, [getDisplayPath, pendingFocusDisplayPath, rows, setFocusedIndex]);

	const handleDragStart = useCallback((event: DragStartEvent) => {
		const data = event.active.data.current as DragItemData | undefined;
		setActiveDragLabel(data?.label ?? null);
	}, []);
	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveDragLabel(null);
			setDropTarget(null);
			if (!onMoveItem || !event.over) return;
			const item = event.active.data.current as DragItemData | undefined;
			const target = event.over.data.current as DropTargetData | undefined;
			if (!item || !target) return;
			const targetFolderId = target.folderId;
			if (isInvalidMove(item, targetFolderId)) return;
			void onMoveItem({
				item:
					item.kind === "file"
						? { kind: "file", path: item.path }
						: { kind: "folder", folderId: item.folderId },
				targetFolderId,
			});
		},
		[onMoveItem],
	);
	const handleDragOver = useCallback((event: DragOverEvent) => {
		const target = event.over?.data.current as DropTargetData | undefined;
		setDropTarget(
			event.over
				? { id: String(event.over.id), folderId: target?.folderId ?? null }
				: null,
		);
	}, []);

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
		if (!renameTarget) return;
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [renameTarget]);

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

	const resetRename = useCallback(() => {
		setRenameTarget(null);
		setRenameDraft("");
		setDeleteOnCancel(null);
		setRenameError(null);
	}, []);

	const cancelRename = useCallback(() => {
		const shouldDelete =
			deleteOnCancel &&
			renameTarget?.kind === "file" &&
			deleteOnCancel.path === renameTarget.path &&
			deleteOnCancel.draft === renameDraft;
		if (shouldDelete && onDeleteFile) onDeleteFile(deleteOnCancel.path);
		resetRename();
	}, [deleteOnCancel, onDeleteFile, renameDraft, renameTarget, resetRename]);

	const getRenameError = useCallback(
		(target: RenameTarget, draft: string) => {
			const nextName = draft.trim();
			if (!nextName) return null;
			const sourceDisplayPath =
				target.kind === "file"
					? normalizeDisplayPath(getDisplayPath(target.path))
					: folderIdToComparableDisplayPath(target.folderId);
			const targetDisplayPath =
				target.kind === "file"
					? renameTargetDisplayPath(target.path, nextName, getDisplayPath)
					: folderRenameTargetDisplayPath(target.folderId, nextName);
			const targetName = fileNameFromPath(targetDisplayPath);
			if (
				!renameTargetExists({
					files,
					folders,
					getDisplayPath,
					sourceDisplayPath,
					sourcePath: target.kind === "file" ? target.path : null,
					targetDisplayPath,
				})
			) {
				return null;
			}
			return `A ${target.kind} ${targetName} already exists at this location.`;
		},
		[files, folders, getDisplayPath],
	);

	const commitRename = useCallback(
		(focusTree = false) => {
			const target = renameTarget;
			if (!target) return;
			if (target.kind === "file" && !onRenameFile) return;
			if (target.kind === "folder" && !onRenameFolder) return;
			const nextName = renameDraft.trim();
			if (!nextName) {
				resetRename();
				if (focusTree) requestAnimationFrame(() => navRef.current?.focus());
				return;
			}
			const error = getRenameError(target, nextName);
			if (error) {
				setRenameError(error);
				requestAnimationFrame(() => renameInputRef.current?.focus());
				return;
			}
			const targetDisplayPath =
				target.kind === "file"
					? renameTargetDisplayPath(target.path, nextName, getDisplayPath)
					: folderRenameTargetDisplayPath(target.folderId, nextName);
			if (focusTree) {
				setPendingFocusDisplayPath(targetDisplayPath);
				requestAnimationFrame(() => navRef.current?.focus());
			}
			resetRename();
			if (target.kind === "file") {
				onRenameFile?.(target.path, nextName);
			} else {
				migrateExpandedFolder(target.folderId, `${targetDisplayPath}/`);
				onRenameFolder?.(target.folderId, nextName);
			}
		},
		[
			getRenameError,
			migrateExpandedFolder,
			onRenameFile,
			onRenameFolder,
			renameDraft,
			renameTarget,
			resetRename,
			getDisplayPath,
		],
	);

	const tree = (
		<DndContext
			collisionDetection={segmentFirstCollision}
			sensors={sensors}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragEnd={handleDragEnd}
			onDragCancel={() => {
				setActiveDragLabel(null);
				setDropTarget(null);
			}}
		>
			<DroppableSidebarNav
				ref={navRef}
				enabled={Boolean(onMoveItem)}
				onKeyDown={onKeyDown}
			>
				{rows.length === 0 && emptyState}
				{rows.map((row, index) => {
					const isActive =
						row.kind === "file" && row.file.path === highlightPath;
					const isFocused = focusedIndex === index;
					const isRenaming =
						(row.kind === "file" &&
							renameTarget?.kind === "file" &&
							row.file.path === renameTarget.path) ||
						(row.kind === "folder" &&
							renameTarget?.kind === "folder" &&
							row.id === renameTarget.folderId);
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
									aria-selected={isActive}
									className={cn(
										"group/sidebar-row relative flex w-full items-center text-sidebar-foreground",
										!isActive && isFocused && "bg-accent",
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
											: "rounded-[var(--radius-row)]",
										isRenaming && "relative z-30",
										isPinnedSectionEnd && "mb-3",
										activeDragLabel && isActive && !dropGroup && "grayscale",
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
											!onCreateFile &&
											!onRenameFolder &&
											!onDeleteFolder
										)
											return;
										event.preventDefault();
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
																	{ kind: "folder", folderId: row.id },
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
											onClick={(event) => {
												if (row.kind === "file" && event.detail > 1) return;
												activateRow(row);
												requestAnimationFrame(() => navRef.current?.focus());
											}}
											onDoubleClick={(event) => {
												if (row.kind !== "file" || !onRenameFile) return;
												event.preventDefault();
												beginRename(row.file, row.label);
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
													: "bg-linear-to-r from-transparent from-0% via-accent via-25% to-accent",
											)}
										/>
									)}
									<div className="absolute inset-y-0 end-0.5 flex items-center gap-0.5">
										{row.kind === "folder" &&
											(onRevealFolder ||
												onCreateFile ||
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
													onRenameFolder={beginFolderRename}
													onDeleteFolder={onDeleteFolder}
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
													onRenameFile={beginRename}
													onTogglePinnedFile={onTogglePinnedFile}
													onDeleteFile={onDeleteFile}
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
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="New file"
							title="New file"
							onClick={() => void createFile(null)}
						>
							<MingcuteEditLine className="size-3.5" />
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
							<Select.Positioner align="end" side="bottom" sideOffset={4}>
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

type DragItemData =
	| { kind: "file"; path: string; parentFolderId: string | null; label: string }
	| {
			kind: "folder";
			folderId: string;
			parentFolderId: string | null;
			label: string;
	  };

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
	const data: DragItemData =
		row.kind === "file"
			? {
					kind: "file",
					path: row.file.path,
					parentFolderId: folderIdFromDisplayPath(
						getDisplayPath(row.file.path),
					),
					label: row.label,
				}
			: {
					kind: "folder",
					folderId: row.id,
					parentFolderId: parentFolderId(row.id),
					label: row.label,
				};
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
	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			setNodeRef(node);
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		},
		[ref, setNodeRef],
	);
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
	const setRefs = useCallback(
		(node: HTMLSpanElement | null) => {
			setDragRef(node);
			setNodeRef(node);
		},
		[setDragRef, setNodeRef],
	);
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

function isInvalidMove(item: DragItemData, targetFolderId: string | null) {
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
	const pointerIdRef = useRef<number | null>(null);
	const inlineStartRef = useRef(0);
	const widthStorageKey = sidebarWidthStorageKey(storageScope);
	const [sidebarWidth, setSidebarWidth] = useState(() =>
		readSidebarWidth(widthStorageKey),
	);
	const sidebarWidthRef = useRef(sidebarWidth);
	const previewCollapsedRef = useRef(false);
	const [isResizing, setIsResizing] = useState(false);
	const [previewCollapsed, setPreviewCollapsedState] = useState(false);

	useEffect(() => {
		const nextWidth = readSidebarWidth(widthStorageKey);
		sidebarWidthRef.current = nextWidth;
		setSidebarWidth(nextWidth);
	}, [widthStorageKey]);

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

	function finishResize(event?: ReactPointerEvent<HTMLDivElement>) {
		const pointerId = pointerIdRef.current;
		if (
			pointerId !== null &&
			event?.currentTarget.hasPointerCapture(pointerId)
		) {
			event.currentTarget.releasePointerCapture(pointerId);
		}
		pointerIdRef.current = null;
		setIsResizing(false);
		const shouldCollapse = previewCollapsedRef.current;
		setPreviewCollapsed(false);
		if (shouldCollapse && onCollapse) {
			onCollapse();
			return;
		}
		writeSidebarWidth(widthStorageKey, sidebarWidthRef.current);
	}

	function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
		event.preventDefault();
		pointerIdRef.current = event.pointerId;
		inlineStartRef.current =
			asideRef.current?.getBoundingClientRect().left ?? 0;
		event.currentTarget.setPointerCapture(event.pointerId);
		setPreviewCollapsed(false);
		setIsResizing(true);
	}

	function resize(event: ReactPointerEvent<HTMLDivElement>) {
		if (pointerIdRef.current !== event.pointerId) return;
		event.preventDefault();
		if (onCollapse && event.clientX <= COLLAPSE_EDGE_DISTANCE) {
			setPreviewCollapsed(true);
			return;
		}
		setPreviewCollapsed(false);
		setWidth(event.clientX - inlineStartRef.current);
	}

	function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
		let nextWidth: number | null = null;
		if (event.key === "ArrowLeft") {
			nextWidth = sidebarWidth - 16;
		} else if (event.key === "ArrowRight") {
			nextWidth = sidebarWidth + 16;
		} else if (event.key === "Home") {
			nextWidth = MIN_SIDEBAR_WIDTH;
		} else if (event.key === "End") {
			nextWidth = MAX_SIDEBAR_WIDTH;
		}
		if (nextWidth === null) return;
		event.preventDefault();
		setWidth(nextWidth);
		writeSidebarWidth(widthStorageKey, sidebarWidthRef.current);
	}

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
			{/* biome-ignore lint/a11y/useSemanticElements: interactive splitters use ARIA separator semantics; hr is not reliable for pointer dragging here. */}
			<div
				className="group absolute z-20 cursor-col-resize outline-none [inset-block:0]"
				style={{
					inlineSize: RESIZE_HANDLE_WIDTH,
					insetInlineEnd: -(RESIZE_HANDLE_WIDTH / 2),
				}}
				// A resizable split pane maps to the ARIA separator pattern:
				// arrow keys resize, Home/End jump to min/max, and pointer drag works normally.
				aria-label="Resize sidebar"
				role="separator"
				aria-orientation="vertical"
				aria-valuemin={MIN_SIDEBAR_WIDTH}
				aria-valuemax={MAX_SIDEBAR_WIDTH}
				aria-valuenow={sidebarWidth}
				tabIndex={0}
				onKeyDown={resizeWithKeyboard}
				onPointerDown={beginResize}
				onPointerMove={resize}
				onPointerUp={finishResize}
				onPointerCancel={finishResize}
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

function FolderActionsMenu({
	id,
	label,
	open,
	onOpenChange,
	onRevealFolder,
	revealLabel,
	onCreateFile,
	onRenameFolder,
	onDeleteFolder,
}: {
	id: string;
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRevealFolder?: (id: string) => void;
	revealLabel?: string;
	onCreateFile?: (id: string) => void;
	onRenameFolder?: (id: string) => void;
	onDeleteFolder?: (id: string) => void;
}) {
	return (
		<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
			{onRevealFolder && (
				<ActionItem
					icon={<MingcuteFolderOpenLine />}
					onClick={() => onRevealFolder(id)}
					shortcut="⌘⌥R"
				>
					{revealLabel ?? "Reveal in File Manager"}
				</ActionItem>
			)}
			{onCreateFile && (
				<ActionItem
					icon={<MingcuteEditLine />}
					onClick={() => onCreateFile(id)}
				>
					New file
				</ActionItem>
			)}
			{onRenameFolder && (
				<ActionItem
					icon={<MingcuteEditLine />}
					onClick={() => onRenameFolder(id)}
				>
					Rename
				</ActionItem>
			)}
			{onDeleteFolder && (
				<ActionItem
					destructive
					icon={<MingcuteDeleteLine />}
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
	onRevealFile,
	onCopyFilePath,
	revealLabel,
	onRenameFile,
	onTogglePinnedFile,
	onDeleteFile,
}: {
	file: SidebarFile;
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRevealFile?: (path: string) => void;
	onCopyFilePath?: (path: string) => void;
	revealLabel?: string;
	onRenameFile?: (file: SidebarFile, label: string) => void;
	onTogglePinnedFile?: (path: string) => void;
	onDeleteFile?: (path: string) => void;
}) {
	return (
		<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
			{onRevealFile && (
				<ActionItem
					icon={<MingcuteFolderOpenLine />}
					onClick={() => onRevealFile(file.path)}
					shortcut="⌘⌥R"
				>
					{revealLabel ?? "Reveal in File Manager"}
				</ActionItem>
			)}
			{onCopyFilePath && (
				<ActionItem
					icon={<MingcuteCopy2Line />}
					onClick={() => onCopyFilePath(file.path)}
					shortcut="⌘⇧C"
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
				<Menu.Positioner align="end" side="bottom" sideOffset={4}>
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

function renameTargetExists({
	files,
	folders = [],
	getDisplayPath,
	sourceDisplayPath,
	sourcePath,
	targetDisplayPath,
}: {
	files: SidebarFile[];
	folders?: SidebarFolder[];
	getDisplayPath: (path: string) => string;
	sourceDisplayPath: string;
	sourcePath: string | null;
	targetDisplayPath: string;
}) {
	const targetKey = targetDisplayPath.toLocaleLowerCase();
	for (const file of files) {
		if (sourcePath && file.path === sourcePath) continue;
		if (
			normalizeDisplayPath(getDisplayPath(file.path)).toLocaleLowerCase() ===
			targetKey
		) {
			return true;
		}
	}
	for (const folder of folders) {
		const displayPath = normalizeDisplayPath(getDisplayPath(folder.path));
		if (displayPath === sourceDisplayPath) continue;
		if (displayPath.toLocaleLowerCase() === targetKey) return true;
	}
	return false;
}

function renameTargetDisplayPath(
	path: string,
	nextName: string,
	getDisplayPath: (path: string) => string,
) {
	const sourceDisplayPath = normalizeDisplayPath(getDisplayPath(path));
	const sourceName = fileNameFromPath(sourceDisplayPath);
	const { extension } = splitFileName(sourceName);
	const parent = dirname(sourceDisplayPath);
	const targetName = stripMatchingExtension(nextName.trim(), extension);
	return normalizeDisplayPath(
		parent
			? `${parent}/${targetName}${extension}`
			: `${targetName}${extension}`,
	);
}

function folderRenameTargetDisplayPath(folderId: string, nextName: string) {
	const sourceDisplayPath = folderIdToComparableDisplayPath(folderId);
	const parent = dirname(sourceDisplayPath);
	const targetName = normalizeDisplayPath(nextName.trim());
	if (targetName.includes("/")) return targetName;
	return normalizeDisplayPath(parent ? `${parent}/${targetName}` : targetName);
}

function folderIdToComparableDisplayPath(folderId: string) {
	return normalizeDisplayPath(folderId).replace(/\/+$/, "");
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
