import { isMac } from "keymatch";
import {
	type CSSProperties,
	type HTMLAttributes,
	useEffect,
	useRef,
	useState,
} from "react";
import MingcuteAddLine from "~icons/mingcute/add-line";
import MingcuteLayoutLeftLine from "~icons/mingcute/layout-left-line";
import { fileNameFromPath } from "../lib/filePath";
import { formatShortcut } from "../lib/shortcut";
import { Button } from "../primitives/button";

const START_INSET = isMac() ? "var(--hubble-traffic-light-inset, 70px)" : "8px";
const END_INSET = isMac()
	? "0px"
	: "calc(100vw - env(titlebar-area-width, calc(100vw - 138px)))";
const ACTIONS_BASIS = "114px";
const DEFAULT_SIDEBAR_WIDTH = "220px";
const NO_DRAG_STYLE = {
	WebkitAppRegion: "no-drag",
} as CSSProperties;

// Clusters shrink from ACTIONS_BASIS by default; passing `width` pins them to
// an exact size instead (used to match the sidebar seam).
function ToolbarCluster({
	children,
	align = "start",
	width,
	platformInset = true,
}: {
	children?: React.ReactNode;
	align?: "start" | "end";
	width?: string;
	platformInset?: boolean;
}) {
	return (
		<div
			className={`flex items-center gap-1 px-2 ${align === "end" ? "justify-end" : ""}`}
			style={{
				...(width
					? { flex: "0 0 auto", inlineSize: width, maxInlineSize: width }
					: { flex: `0 100 ${ACTIONS_BASIS}` }),
				...(align === "start"
					? { paddingInlineStart: platformInset ? START_INSET : 0 }
					: { paddingInlineEnd: platformInset ? END_INSET : 0 }),
				...NO_DRAG_STYLE,
			}}
		>
			{children}
		</div>
	);
}

export function Toolbar({
	currentPath,
	sidebarOpen,
	sidebarBadge,
	scrollContainer,
	platformInset = true,
	leftSlot,
	rightSlot,
	onToggleSidebar,
	onRenameCurrentPath,
	rootProps,
}: {
	currentPath: string | null;
	sidebarOpen: boolean;
	sidebarBadge?: boolean;
	scrollContainer?: HTMLDivElement | null;
	platformInset?: boolean;
	leftSlot?: React.ReactNode;
	rightSlot?: React.ReactNode;
	onToggleSidebar?: () => void;
	onRenameCurrentPath?: (nextName: string) => void | Promise<void>;
	rootProps?: HTMLAttributes<HTMLDivElement> &
		Record<`data-${string}`, unknown>;
}) {
	const [showBorder, setShowBorder] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [draftTitle, setDraftTitle] = useState("");
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const title = currentPath ? fileNameFromPath(currentPath) : "";

	useEffect(() => {
		if (!scrollContainer) {
			setShowBorder(false);
			return;
		}
		const update = () => setShowBorder(scrollContainer.scrollTop > 0);
		update();
		scrollContainer.addEventListener("scroll", update, { passive: true });
		return () => scrollContainer.removeEventListener("scroll", update);
	}, [scrollContainer]);

	useEffect(() => {
		if (!editingTitle) return;
		titleInputRef.current?.focus();
		titleInputRef.current?.select();
	}, [editingTitle]);

	function beginTitleEdit() {
		if (!title || !onRenameCurrentPath) return;
		setDraftTitle(title);
		setEditingTitle(true);
	}

	function cancelTitleEdit() {
		setEditingTitle(false);
		setDraftTitle("");
	}

	async function commitTitleEdit() {
		const nextTitle = draftTitle.trim();
		cancelTitleEdit();
		if (!nextTitle || nextTitle === title || !onRenameCurrentPath) return;
		await onRenameCurrentPath(nextTitle);
	}

	const borderClass = sidebarOpen
		? "border-b border-border"
		: showBorder
			? "[border-block-end:1px_dashed_var(--border)]"
			: "border-transparent";

	return (
		<div
			{...rootProps}
			className={`flex h-9 select-none items-center ${borderClass} ${rootProps?.className ?? ""}`}
		>
			<ToolbarCluster
				width={
					sidebarOpen
						? `var(--sidebar-width, ${DEFAULT_SIDEBAR_WIDTH})`
						: undefined
				}
				platformInset={platformInset}
			>
				{onToggleSidebar && (
					<Button
						variant="ghost"
						size="icon-sm"
						className="relative"
						onClick={onToggleSidebar}
						aria-label="Toggle sidebar"
						title={`Toggle sidebar (${formatShortcut("CmdOrCtrl+Shift+E")})`}
					>
						<MingcuteLayoutLeftLine className="size-4" />
						{sidebarBadge ? (
							<span className="absolute top-1 end-1 size-1.5 rounded-full bg-primary" />
						) : null}
					</Button>
				)}
				{leftSlot ? (
					sidebarOpen ? (
						<div className="ms-auto flex items-center gap-1">{leftSlot}</div>
					) : (
						leftSlot
					)
				) : null}
			</ToolbarCluster>
			<div className="flex min-w-0 justify-center" style={{ flex: "1 1 auto" }}>
				{editingTitle ? (
					<input
						ref={titleInputRef}
						className="h-6 min-w-0 max-w-full select-text rounded-sm bg-transparent px-1 text-center text-xs text-foreground outline-none focus-visible:outline-none focus-visible:ring-0"
						style={NO_DRAG_STYLE}
						value={draftTitle}
						onBlur={() => void commitTitleEdit()}
						onChange={(event) => setDraftTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void commitTitleEdit();
							} else if (event.key === "Escape") {
								event.preventDefault();
								cancelTitleEdit();
							}
						}}
					/>
				) : (
					<button
						type="button"
						className="min-w-0 truncate rounded-sm px-1 text-center text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-0"
						style={NO_DRAG_STYLE}
						onClick={beginTitleEdit}
						disabled={!title || !onRenameCurrentPath}
					>
						{title || "\u00A0"}
					</button>
				)}
			</div>
			<ToolbarCluster align="end" platformInset={platformInset}>
				{rightSlot}
			</ToolbarCluster>
		</div>
	);
}

export function NewNoteButton({ onClick }: { onClick: () => void }) {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={onClick}
			aria-label="New Markdown File"
			title={`New Markdown File (${formatShortcut("CmdOrCtrl+N")})`}
		>
			<MingcuteAddLine className="size-4" />
		</Button>
	);
}
