import { Button } from "@hubble.md/ui";
import { useEffect, useState } from "react";
import { getPrimaryButton } from "../components/UpdatesSection";
import { desktopApi } from "../desktopApi";
import type { DesktopUpdateState } from "../desktopApi/types";

const RELEASES_URL = "https://github.com/bholmesdev/hubble.md/releases/latest";

/**
 * Shown in place of the canvas once tldraw rejects this build's license key,
 * which tldraw would otherwise answer with a blank editor. A newer build
 * carries a renewed key, so the way out is updating.
 */
export function DiagramLicenseNotice({ path }: { path: string }) {
	const [update, setUpdate] = useState<DesktopUpdateState | null>(null);

	useEffect(() => {
		let active = true;
		void desktopApi.getUpdateState().then((state) => {
			if (!active) return;
			setUpdate(state);
			// Start looking right away, so "Restart to Update" is usually ready
			// by the time it's needed.
			if (state.isSupported && state.status === "idle") {
				void desktopApi.checkForUpdates();
			}
		});
		const stop = desktopApi.onUpdateStateChange(setUpdate);
		return () => {
			active = false;
			stop();
		};
	}, []);

	// Builds without the updater (Linux packages, winget) download by hand.
	const button =
		update && !update.isSupported
			? {
					label: "Download Update",
					disabled: false,
					variant: "default" as const,
				}
			: update
				? getPrimaryButton(update)
				: null;
	const runUpdate = () => {
		if (!update?.isSupported) {
			void desktopApi.openExternalUrl(RELEASES_URL);
		} else if (update.status === "ready") {
			void desktopApi.installUpdate();
		} else {
			void desktopApi.checkForUpdates();
		}
	};
	const status =
		update?.status === "up-to-date"
			? "No newer version is available yet."
			: update?.status === "error"
				? update.message
				: null;

	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<div className="flex w-full max-w-sm flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<h2 className="text-xl font-semibold tracking-tight text-foreground">
						Update Hubble to edit diagrams
					</h2>
					<p className="text-sm text-muted-foreground">
						Your diagram is saved and unchanged.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{button ? (
						<Button
							size="sm"
							variant={button.variant}
							disabled={button.disabled}
							onClick={runUpdate}
						>
							{button.label}
						</Button>
					) : null}
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void desktopApi.openPathInDefaultApp(path)}
					>
						Open in Default App
					</Button>
				</div>
				{status ? (
					<p className="text-xs text-muted-foreground">{status}</p>
				) : null}
			</div>
		</div>
	);
}
