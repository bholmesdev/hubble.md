import { Button } from "@hubble.md/ui";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import MingcuteCheckCircleFill from "~icons/mingcute/check-circle-fill";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import { desktopApi } from "../desktopApi";
import { copyText } from "../lib/clipboard";
import { dirname } from "../lib/filePath";
import { hasHubbleSkillsInstalled } from "../lib/hubbleSkills";
import { tildePath } from "../lib/tildePath";

// No -g, so the skills CLI asks which agents and folder to install into.
const INSTALL_COMMAND = "npx skills add bholmesdev/hubble.md";
const SKILLS_POLL_INTERVAL_MS = 2000;

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
	const [skillsInstalled, setSkillsInstalled] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [showManualInstall, setShowManualInstall] = useState(false);
	// Without a workspace, treat the file's folder as the notes folder so the
	// prompt stays sensible and detection still covers the global skill dirs.
	const notesPath = workspacePath ?? dirname(path) ?? path;

	// Poll while visible and not yet installed, so installing from a terminal
	// (e.g. with the skills CLI) reflects here without refocusing the window.
	// Detection is a handful of readdirs, and polling stops as soon as the
	// skills are found.
	useEffect(() => {
		if (skillsInstalled) return;
		let active = true;
		const check = () => {
			void hasHubbleSkillsInstalled(notesPath).then((installed) => {
				if (active && installed) setSkillsInstalled(true);
			});
		};
		check();
		const interval = setInterval(check, SKILLS_POLL_INTERVAL_MS);
		return () => {
			active = false;
			clearInterval(interval);
		};
	}, [notesPath, skillsInstalled]);

	const installSkills = async () => {
		setInstalling(true);
		try {
			await desktopApi.installAgentSkills();
			if (await hasHubbleSkillsInstalled(notesPath)) setSkillsInstalled(true);
		} catch (error) {
			toast.error("Failed to install skills", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
		setInstalling(false);
	};

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
						skillsInstalled ? (
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
									onClick={() => void installSkills()}
								>
									{installing ? "Installing..." : "Install"}
								</Button>
							</span>
						)
					}
				>
					{showManualInstall && !skillsInstalled ? (
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

function CopyBlock({
	value,
	display,
	label,
	ariaLabel,
}: {
	value: string;
	display?: string;
	label: string;
	ariaLabel: string;
}) {
	return (
		<div className="flex items-start gap-2 rounded-sm border border-border bg-muted/40 p-2">
			<code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
				{display ?? value}
			</code>
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label={ariaLabel}
				onClick={() => void copyText(value, label)}
			>
				<MingcuteCopy2Line />
			</Button>
		</div>
	);
}
