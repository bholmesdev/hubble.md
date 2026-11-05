import { Modal } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import { dirname } from "../lib/filePath";
import {
	INSTALL_COMMAND,
	installHubbleSkills,
	useHubbleSkills,
} from "../lib/hubbleSkills";
import { skillToastDismissedStore, workspacePathStore } from "../store/state";
import { CopyBlock } from "./CopyBlock";

const TOAST_ID = "hubble-skills";

/**
 * Offers the Hubble skills in a toast while a diagram is open, so agents edit
 * it with edit-diagram. Renders nothing itself.
 */
export function DiagramSkillToast({ path }: { path: string }) {
	const workspacePath = useStoreValue(workspacePathStore);
	const dismissed = useStoreValue(skillToastDismissedStore);
	const { installed } = useHubbleSkills(workspacePath ?? dirname(path) ?? path);
	const show = installed === false && !dismissed;

	useEffect(() => {
		if (!show) return;
		toast.custom(() => <SkillToast />, {
			id: TOAST_ID,
			duration: Number.POSITIVE_INFINITY,
		});
		return () => {
			toast.dismiss(TOAST_ID);
		};
	}, [show]);

	return null;
}

function SkillToast() {
	const [installing, setInstalling] = useState(false);
	const [manualOpen, setManualOpen] = useState(false);

	const install = async () => {
		setInstalling(true);
		await installHubbleSkills();
		toast.dismiss(TOAST_ID);
	};

	return (
		<div className="hubble-toast relative flex w-[var(--width)] flex-col gap-2 p-4">
			<button
				type="button"
				aria-label="Dismiss"
				// Closing it keeps it away for good; Help → Install Agent Skills
				// still works.
				onClick={() => skillToastDismissedStore.set(true)}
				className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
			>
				<MingcuteCloseLine className="size-3.5" />
			</button>
			<div className="flex flex-col gap-0.5 pe-5">
				<span className="hubble-toast-title">Let your agent edit diagrams</span>
				<span className="hubble-toast-description">
					Install the Hubble skills for your coding agents.
				</span>
			</div>
			<div className="flex gap-1.5">
				<button
					type="button"
					className="hubble-toast-cancel"
					disabled={installing}
					onClick={() => void install()}
				>
					{installing ? "Installing..." : "Install"}
				</button>
				<button
					type="button"
					className="hubble-toast-action"
					onClick={() => setManualOpen(true)}
				>
					Install manually
				</button>
			</div>
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
