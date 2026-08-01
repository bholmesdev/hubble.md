import { Button, Switch } from "@hubble.md/ui";
import { useEffect, useState } from "react";
import { desktopApi } from "../desktopApi";
import type { CaptureClientState } from "../desktopApi/types";
import { SettingsSection } from "./SettingsDialog";

/** macOS never reports an Accessibility grant, so the toggle polls for it. */
const ACCESSIBILITY_POLL_MS = 1000;

export function CaptureSettings() {
	const [state, setState] = useState<CaptureClientState | null>(null);

	useEffect(() => {
		void desktopApi.captureGetState().then(setState);
	}, []);

	// Granting Accessibility happens in System Settings with no callback, so
	// poll while enabled-but-ungranted and light the toggle up when it lands.
	useEffect(() => {
		if (!state?.settings.enabled || state.hasAccessibility) return;
		const timer = setInterval(async () => {
			const next = await desktopApi.captureRecheckAccessibility();
			setState((current) => (current ? { ...current, ...next } : current));
		}, ACCESSIBILITY_POLL_MS);
		return () => clearInterval(timer);
	}, [state?.settings.enabled, state?.hasAccessibility]);

	if (!state) return null;

	const { settings, hasAccessibility } = state;
	const waitingForPermission = settings.enabled && !hasAccessibility;

	return (
		<SettingsSection
			title="Capture"
			description="Double-tap Shift anywhere to open a notepad. Notes save as markdown in your workspace."
			action={
				<Switch
					checked={settings.enabled}
					onCheckedChange={(enabled) => {
						void desktopApi
							.captureSetEnabled(enabled)
							.then((next) =>
								setState((current) =>
									current ? { ...current, ...next } : current,
								),
							);
					}}
				/>
			}
		>
			{waitingForPermission ? (
				<div className="rounded-md border border-border bg-muted/40 p-3">
					<p className="text-xs text-muted-foreground">
						macOS needs Accessibility access to notice the Shift taps. Hubble
						reads modifier keys only, never what you type. Turn Hubble on under
						Privacy &amp; Security &rarr; Accessibility, and this switches on by
						itself.
					</p>
					<Button
						size="sm"
						variant="outline"
						className="mt-2"
						onClick={() => void desktopApi.captureRecheckAccessibility()}
					>
						Open System Settings
					</Button>
				</div>
			) : null}
		</SettingsSection>
	);
}
