import { store } from "@simplestack/store";
import { toast } from "sonner";
import { desktopApi } from "../desktopApi";

/** Skill folders the last install skipped, shown by SkippedSkillsDialog. */
export const skippedSkillsStore = store<string[]>([]);

/**
 * Installs the bundled skills. The empty state's Install button and the Help
 * menu both call this, so they report skipped skills the same way.
 */
export async function installHubbleSkills(): Promise<void> {
	try {
		const skipped = await desktopApi.installHubbleSkills();
		if (skipped.length > 0) skippedSkillsStore.set(skipped);
	} catch (error) {
		toast.error("Failed to install skills", {
			description: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Checks whether every Hubble skill is installed for a workspace. Detection runs
 * in the main process so it can read agent skill folders both inside the
 * workspace and in the user's home dir, which sit outside the renderer's granted
 * file scope. It matches known skill directory names; see the
 * desktop:detect-hubble-skills handler for the exact locations checked.
 */
export async function hasHubbleSkillsInstalled(
	workspacePath: string,
): Promise<boolean> {
	try {
		return await desktopApi.detectHubbleSkills(workspacePath);
	} catch {
		return false;
	}
}
