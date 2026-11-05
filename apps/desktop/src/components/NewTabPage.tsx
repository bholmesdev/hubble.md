import { useCommandShortcut } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { type ReactNode, useEffect, useRef } from "react";
import MingcuteCodeLine from "~icons/mingcute/code-line";
import MingcuteDrawingBoardLine from "~icons/mingcute/drawing-board-line";
import MingcuteFileLine from "~icons/mingcute/file-line";
import MingcuteFileNewLine from "~icons/mingcute/file-new-line";
import MingcuteSearchLine from "~icons/mingcute/search-line";
import {
	createDiagramFile,
	createHtmlFile,
	createMarkdownFile,
} from "../fileActions";
import {
	DIAGRAMS_ENABLED,
	dirname,
	fileStem,
	hasDocumentExtension,
	relativeWorkspacePath,
} from "../lib/filePath";
import { inboxDateLabel } from "../lib/inboxGroups";
import { loadPath } from "../store/actions";
import { workspacePathStore, workspaceStore } from "../store/state";
import { tabsStore } from "../store/tabStore";
import { findTabByPath } from "../store/tabs";

const RECENT_LIMIT = 3;

/** Blank tab content. Everything here opens into the current tab. */
export function NewTabPage({
	folder,
	onSearch,
}: {
	folder: string | null;
	onSearch: () => void;
}) {
	const workspacePath = useStoreValue(workspacePathStore);
	const files = useStoreValue(workspaceStore).files;
	const newFileShortcut = useCommandShortcut("app.new-file");
	const searchShortcut = useCommandShortcut("app.go-to-file");
	const tabs = useStoreValue(tabsStore);
	// Picking an open file would jump to its tab, so only offer closed ones.
	const recent = files
		.filter(
			(file) =>
				hasDocumentExtension(file.path) && !findTabByPath(tabs, file.path),
		)
		.sort((a, b) => b.modified_at - a.modified_at)
		.slice(0, RECENT_LIMIT);
	const optionsRef = useRef<HTMLDivElement>(null);

	// Arrow keys move through the options even before one has focus.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const step =
				event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
			const container = optionsRef.current;
			if (!step || event.defaultPrevented || !container) return;
			const active = document.activeElement;
			if (active && active !== document.body && !container.contains(active))
				return;
			const options = [
				...container.querySelectorAll<HTMLElement>("[data-new-tab-option]"),
			];
			const at = options.indexOf(active as HTMLElement);
			const next =
				at < 0
					? step > 0
						? 0
						: options.length - 1
					: Math.min(Math.max(at + step, 0), options.length - 1);
			event.preventDefault();
			options[next]?.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		// Top-anchored so Recent filling in after a folder switch can't shift the rest.
		<div className="flex h-full justify-center overflow-auto p-6 pt-[25vh]">
			<div ref={optionsRef} className="flex w-full max-w-sm flex-col gap-6">
				<button
					type="button"
					data-new-tab-option
					onClick={onSearch}
					className="flex w-full items-center gap-2.5 rounded-md border border-border px-3 py-2 text-start text-sm text-muted-foreground hover:border-brand-accent hover:text-foreground focus-visible:border-brand-accent focus-visible:text-foreground focus-visible:outline-hidden"
				>
					<MingcuteSearchLine className="size-4" />
					Search for files
					{searchShortcut && <Kbd className="ms-auto">{searchShortcut}</Kbd>}
				</button>
				<section className="flex flex-col gap-1">
					<NewTabAction
						icon={<MingcuteFileNewLine className="size-4" />}
						label="New file"
						shortcut={newFileShortcut}
						onClick={() => void createMarkdownFile(folder)}
					/>
					<NewTabAction
						icon={<MingcuteCodeLine className="size-4" />}
						label="New HTML app"
						onClick={() => void createHtmlFile(folder)}
					/>
					{DIAGRAMS_ENABLED && (
						<NewTabAction
							icon={<MingcuteDrawingBoardLine className="size-4" />}
							label="New diagram"
							onClick={() => void createDiagramFile(folder)}
						/>
					)}
				</section>
				{recent.length > 0 && (
					<section className="flex flex-col gap-1">
						<h3 className="px-2 text-[11px] font-medium text-muted-foreground">
							Recent
						</h3>
						{recent.map((file) => {
							const folderLabel = dirname(
								relativeWorkspacePath(file.path, workspacePath ?? null),
							);
							return (
								<NewTabAction
									key={file.path}
									icon={<MingcuteFileLine className="size-4" />}
									label={fileStem(file.path)}
									detail={
										folderLabel && folderLabel !== "." ? folderLabel : undefined
									}
									trailing={inboxDateLabel(file.modified_at * 1000)}
									onClick={() => void loadPath(file.path)}
								/>
							);
						})}
					</section>
				)}
			</div>
		</div>
	);
}

function NewTabAction({
	icon,
	label,
	detail,
	trailing,
	shortcut,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	detail?: string;
	trailing?: string;
	shortcut?: string | null;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-new-tab-option
			onClick={onClick}
			className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
		>
			<span className="text-muted-foreground">{icon}</span>
			<span className="truncate">{label}</span>
			{detail && (
				<span className="truncate text-xs text-muted-foreground">{detail}</span>
			)}
			{trailing && (
				<span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
					{trailing}
				</span>
			)}
			{shortcut && <Kbd className="ms-auto">{shortcut}</Kbd>}
		</button>
	);
}

function Kbd({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<kbd
			className={`shrink-0 rounded-[var(--radius-inner)] border border-border px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground ${className ?? ""}`}
		>
			{children}
		</kbd>
	);
}
