import { Button, Modal } from "@hubble.md/ui";
import { store } from "@simplestack/store";
import { useStoreValue } from "@simplestack/store/react";
import { useState } from "react";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import { dirname } from "../lib/filePath";
import { INSTALL_COMMAND, useHubbleSkills } from "../lib/hubbleSkills";
import { workspacePathStore } from "../store/state";
import { CopyBlock } from "./CopyBlock";

// Dismissing hides the banner on every diagram until Hubble restarts.
const dismissedStore = store(false);

/** Offers the Hubble skills over a diagram, so agents edit it with edit-diagram. */
export function DiagramSkillBanner({ path }: { path: string }) {
	const workspacePath = useStoreValue(workspacePathStore);
	const dismissed = useStoreValue(dismissedStore);
	const { installed, installing, install } = useHubbleSkills(
		workspacePath ?? dirname(path) ?? path,
	);
	const [manualOpen, setManualOpen] = useState(false);
	if (installed !== false || dismissed) return null;

	return (
		<div className="absolute top-2 left-1/2 z-[350] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-sm border border-border bg-popover py-1 ps-3 pe-1 text-xs text-popover-foreground shadow-overlay">
			<span className="me-1">
				Install the Hubble skills so your agent can edit diagrams.
			</span>
			<Button size="sm" variant="ghost" onClick={() => setManualOpen(true)}>
				Install manually
			</Button>
			<Button size="sm" disabled={installing} onClick={() => void install()}>
				{installing ? "Installing..." : "Install"}
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label="Dismiss"
				onClick={() => dismissedStore.set(true)}
			>
				<MingcuteCloseLine />
			</Button>
			<Modal
				open={manualOpen}
				onOpenChange={setManualOpen}
				title="Install the skills manually"
				description="Run this in your terminal. The skills CLI asks which agents to install them for."
			>
				<CopyBlock
					value={INSTALL_COMMAND}
					label="Command"
					ariaLabel="Copy install command"
				/>
			</Modal>
		</div>
	);
}
