import { Button } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { type ReactNode, useState } from "react";
import MingcuteCheckCircleFill from "~icons/mingcute/check-circle-fill";
import MingcuteDownload2Line from "~icons/mingcute/download-2-line";
import MingcuteLoadingLine from "~icons/mingcute/loading-line";
import { useHubbleSkills } from "../lib/hubbleSkills";
import { workspacePathStore } from "../store/state";
import { ManualInstallModal } from "./ManualInstallModal";
import { SettingsSection } from "./SettingsDialog";

export function SkillsSettings({
	title = "Agent skills",
	iconOnlyInstall = false,
	description = "Teach your agents how to use Hubble's features: build HTML apps, edit diagrams, or leave and respond to comments.",
}: {
	title?: ReactNode;
	iconOnlyInstall?: boolean;
	description?: ReactNode;
}) {
	const workspacePath = useStoreValue(workspacePathStore);
	const { installed, installing, install } = useHubbleSkills(workspacePath);
	const [manualOpen, setManualOpen] = useState(false);

	return (
		<>
			<SettingsSection
				title={title}
				description={description}
				action={
					installed ? (
						<span
							data-skills-installed
							className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary"
						>
							<MingcuteCheckCircleFill className="size-3.5" />
							Skills installed
						</span>
					) : installed === false ? (
						<span className="inline-flex shrink-0 items-center gap-1">
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setManualOpen(true)}
							>
								Install manually
							</Button>
							<Button
								size={iconOnlyInstall ? "icon-sm" : "sm"}
								aria-label={
									iconOnlyInstall ? "Install Hubble skills" : undefined
								}
								aria-busy={installing}
								disabled={installing}
								onClick={() => void install()}
							>
								{iconOnlyInstall ? (
									installing ? (
										<MingcuteLoadingLine className="size-4 animate-spin motion-reduce:animate-none" />
									) : (
										<MingcuteDownload2Line className="size-4" />
									)
								) : installing ? (
									"Installing..."
								) : (
									"Install"
								)}
							</Button>
						</span>
					) : null
				}
			/>
			<ManualInstallModal open={manualOpen} onOpenChange={setManualOpen} />
		</>
	);
}
