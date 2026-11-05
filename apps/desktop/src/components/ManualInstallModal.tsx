import { Modal } from "@hubble.md/ui";
import { INSTALL_COMMAND } from "../lib/hubbleSkills";
import { CopyBlock } from "./CopyBlock";

/** The skills CLI command to copy, for installing outside Hubble. */
export function ManualInstallModal({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Modal
			open={open}
			onOpenChange={onOpenChange}
			title="Install the skills manually"
			description="Run this in your terminal. The skills CLI asks which agents to install them for."
		>
			<CopyBlock
				value={INSTALL_COMMAND}
				label="Command"
				ariaLabel="Copy install command"
			/>
		</Modal>
	);
}
