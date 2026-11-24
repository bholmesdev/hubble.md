import { store } from "@simplestack/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { desktopApi } from "../desktopApi";

// No -g, so the skills CLI asks which agents and folder to install into.
export const INSTALL_COMMAND = "npx skills add bholmesdev/hubble.md";
const POLL_INTERVAL_MS = 2000;

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
	workspacePath?: string,
): Promise<boolean> {
	try {
		return await desktopApi.detectHubbleSkills(workspacePath);
	} catch {
		return false;
	}
}

/**
 * Whether every Hubble skill is installed, or null until the first check
 * returns. Polls until they are, so installing from a terminal (e.g. with the
 * skills CLI) shows up without refocusing the window. Detection is a handful
 * of readdirs. Window focus re-checks either way, so skills removed while
 * Hubble was in the background bring the Install button back. Without a
 * workspace, only the home dir's skill folders are checked.
 */
export function useHubbleSkills(workspacePath?: string) {
	const [installed, setInstalled] = useState<boolean | null>(null);
	const [installing, setInstalling] = useState(false);

	useEffect(() => {
		let active = true;
		const check = () => {
			void hasHubbleSkillsInstalled(workspacePath).then((result) => {
				if (active) setInstalled(result);
			});
		};
		check();
		window.addEventListener("focus", check);
		const interval = installed
			? undefined
			: setInterval(check, POLL_INTERVAL_MS);
		return () => {
			active = false;
			window.removeEventListener("focus", check);
			clearInterval(interval);
		};
	}, [workspacePath, installed]);

	const install = async () => {
		setInstalling(true);
		await installHubbleSkills();
		setInstalled(await hasHubbleSkillsInstalled(workspacePath));
		setInstalling(false);
	};

	return { installed, installing, install };
}
