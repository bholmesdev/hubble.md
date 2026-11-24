import { Button } from "@hubble.md/ui";
import { useState } from "react";
import MingcuteCheckCircleFill from "~icons/mingcute/check-circle-fill";
import { dirname } from "../lib/filePath";
import { INSTALL_COMMAND, useHubbleSkills } from "../lib/hubbleSkills";
import { tildePath } from "../lib/tildePath";
import { CopyBlock } from "./CopyBlock";

function buildPrompt(filePath: string): string {
	return `Build a Hubble HTML app at ${filePath} that...`;
}

export function HtmlAppEmptyState({
	path,
	workspacePath,
}: {
	path: string;
	workspacePath: string | null;
}) {
	const [showManualInstall, setShowManualInstall] = useState(false);
	// Without a workspace, treat the file's folder as the notes folder so the
	// prompt stays sensible and detection still covers the global skill dirs.
	const notesPath = workspacePath ?? dirname(path) ?? path;
	const { installed, installing, install } = useHubbleSkills(notesPath);

	return (
		<div className="flex h-full items-center justify-center overflow-y-auto p-6">
			<div className="flex w-full max-w-lg flex-col gap-5">
				<div className="flex flex-col gap-1.5">
					<h2 className="text-xl font-semibold tracking-tight text-foreground">
						Build an HTML App
					</h2>
					<p className="text-sm text-muted-foreground">
						HTML Apps are live, interactive views of your notes: dashboards,
						trackers, indexes, anything you can describe. They can read and
						update your notes, and your agent builds one right into this file.
					</p>
				</div>

				<Section
					step="1"
					title="Install the skills"
					indicator={
						installed ? (
							<span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
								<MingcuteCheckCircleFill className="size-3.5" />
								Skills installed
							</span>
						) : (
							<span className="inline-flex items-center gap-1">
								<Button
									size="sm"
									variant="ghost"
									aria-expanded={showManualInstall}
									onClick={() => setShowManualInstall(!showManualInstall)}
								>
									Install manually
								</Button>
								<Button
									size="sm"
									disabled={installing}
									onClick={() => void install()}
								>
									{installing ? "Installing..." : "Install"}
								</Button>
							</span>
						)
					}
				>
					{showManualInstall && !installed ? (
						<>
							<p className="text-xs text-muted-foreground">
								Run this in your terminal:
							</p>
							<CopyBlock
								value={INSTALL_COMMAND}
								label="Command"
								ariaLabel="Copy install command"
							/>
						</>
					) : null}
				</Section>

				<Section step="2" title="Prompt your agent">
					<CopyBlock
						value={buildPrompt(path)}
						display={buildPrompt(tildePath(path))}
						label="Prompt"
						ariaLabel="Copy prompt"
					/>
				</Section>
			</div>
		</div>
	);
}

function Section({
	step,
	title,
	indicator,
	children,
}: {
	step: string;
	title: string;
	indicator?: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
					{step}
				</span>
				<span className="text-xs font-medium text-foreground">{title}</span>
				<span className="ms-auto inline-flex items-center">{indicator}</span>
			</div>
			{children}
		</div>
	);
}
