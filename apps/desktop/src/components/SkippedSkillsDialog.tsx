import { Button, Modal } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { skippedSkillsStore } from "../lib/hubbleSkills";
import { tildePath } from "../lib/tildePath";

export function SkippedSkillsDialog() {
	const skipped = useStoreValue(skippedSkillsStore);
	const close = () => skippedSkillsStore.set([]);

	return (
		<Modal
			open={skipped.length > 0}
			onOpenChange={(open) => {
				if (!open) close();
			}}
			title="Some skills weren't installed"
			description="You already have skills with these names. To install Hubble's versions, remove or rename them, then install again."
		>
			<ul className="flex flex-col gap-1 rounded-sm border border-border bg-muted/40 p-2 font-mono text-xs text-foreground">
				{skipped.map((folder) => (
					<li key={folder} className="break-all">
						{tildePath(folder)}
					</li>
				))}
			</ul>
			<div className="mt-4 flex justify-end">
				<Button size="sm" onClick={close}>
					OK
				</Button>
			</div>
		</Modal>
	);
}
