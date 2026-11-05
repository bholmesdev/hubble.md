import { desktopApi } from "../desktopApi";

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
