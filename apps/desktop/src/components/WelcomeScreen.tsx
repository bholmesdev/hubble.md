import { useCommandShortcut } from "@hubble.md/ui";
import MingcuteFileLine from "~icons/mingcute/file-line";
import MingcuteFolderLine from "~icons/mingcute/folder-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import MingcuteLightningLine from "~icons/mingcute/lightning-line";
import { EmptyStateAction, EmptyStateKbd } from "./EmptyStateAction";
import { SkillsSettings } from "./SkillsSettings";

export function WelcomeScreen({
	onCreateWorkspace,
	onOpenFolder,
	onOpenFile,
}: {
	onCreateWorkspace: () => void;
	onOpenFolder: () => void;
	onOpenFile: () => void;
}) {
	const createShortcut = useCommandShortcut("app.new-workspace");
	const folderShortcut = useCommandShortcut("app.open-folder");
	const fileShortcut = useCommandShortcut("app.open-file");
	return (
		<div className="flex h-full justify-center overflow-auto p-6 pt-[25vh]">
			<div className="flex w-full max-w-sm flex-col gap-6">
				<div
					className="welcome-rise flex flex-col gap-2"
					style={{ animationDelay: "0.05s" }}
				>
					<h2 className="font-rounded text-3xl font-medium tracking-tight">
						Welcome to hubble
					</h2>
					<p className="text-sm text-muted-foreground">
						Let's start writing together.
					</p>
				</div>
				<button
					type="button"
					onClick={onCreateWorkspace}
					style={{ animationDelay: "0.15s" }}
					className="welcome-rise flex min-h-10 w-full items-center gap-2.5 rounded-md border border-brand-accent bg-accent px-3 py-2 text-start text-sm transition-colors hover:bg-brand-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
				>
					<MingcuteFolderLine className="size-4 text-brand-accent" />
					Create new workspace
					{createShortcut && (
						<EmptyStateKbd className="ms-auto">{createShortcut}</EmptyStateKbd>
					)}
				</button>
				<section
					aria-label="Open existing content"
					className="flex flex-col gap-1"
				>
					<div className="welcome-rise" style={{ animationDelay: "0.25s" }}>
						<EmptyStateAction
							icon={<MingcuteFolderOpenLine className="size-4" />}
							className="min-h-10 border border-transparent px-3 py-2"
							label="Open existing folder"
							shortcut={folderShortcut}
							onClick={onOpenFolder}
						/>
					</div>
					<div className="welcome-rise" style={{ animationDelay: "0.35s" }}>
						<EmptyStateAction
							icon={<MingcuteFileLine className="size-4" />}
							className="min-h-10 border border-transparent px-3 py-2"
							label="Open file"
							shortcut={fileShortcut}
							onClick={onOpenFile}
						/>
					</div>
				</section>
				<div
					className="welcome-rise border-t border-border pt-6"
					style={{ animationDelay: "0.45s" }}
				>
					<div className="flex min-h-10 items-center gap-2.5 border border-transparent px-3 py-1">
						<MingcuteLightningLine className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<SkillsSettings
								title={
									<span className="text-sm font-normal">
										Set up agent skills
									</span>
								}
								description={null}
								installVariant="outline"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
