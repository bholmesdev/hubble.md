import { Button, Switch } from "@hubble.md/ui";
import { useEffect, useState } from "react";
import { desktopApi } from "../desktopApi";
import type { CaptureClientState } from "../desktopApi/types";
import { SettingsSection } from "./SettingsDialog";

/** System Settings grants Accessibility access without notifying the app. */
const ACCESSIBILITY_POLL_MS = 1000;

function basename(path: string) {
	const segments = path.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

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

	const { settings, hasAccessibility, shortcutError } = state;
	const waitingForPermission = settings.enabled && !hasAccessibility;

	return (
		<SettingsSection
			title="Capture"
			description="Double-tap Shift anywhere to open a notepad. Notes save as markdown in your workspace."
			action={
				<Switch
					checked={settings.enabled}
					disabled={!state.shortcutSupported}
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
			{!state.shortcutSupported ? (
				<p className="text-xs text-muted-foreground">
					{shortcutError ?? "Capture is not available on this system."}
				</p>
			) : null}
			{settings.enabled && settings.recentWorkspaces.length > 0 ? (
				<div className="flex items-center justify-between gap-3">
					<p className="text-xs text-muted-foreground">Save captures to</p>
					<select
						value={settings.targetWorkspace ?? settings.recentWorkspaces[0]}
						onChange={(event) => {
							const next = event.currentTarget.value;
							void desktopApi
								.captureUpdateSettings({ targetWorkspace: next })
								.then((nextSettings) =>
									setState((current) =>
										current ? { ...current, settings: nextSettings } : current,
									),
								);
						}}
						className="max-w-[55%] truncate rounded border border-border bg-transparent px-1.5 py-0.5 text-xs"
					>
						{settings.recentWorkspaces.map((path) => (
							<option key={path} value={path}>
								{basename(path)}
							</option>
						))}
					</select>
				</div>
			) : null}
			{waitingForPermission ? (
				<div className="rounded-md border border-border bg-muted/40 p-3">
					<p className="text-xs text-muted-foreground">
						macOS needs Accessibility access to detect two Shift taps anywhere.
						Hubble uses this access only for that shortcut and never stores your
						input. Turn Hubble on under Privacy &amp; Security &rarr;
						Accessibility.
					</p>
					<Button
						size="sm"
						variant="outline"
						className="mt-2"
						onClick={() => {
							void desktopApi
								.captureRequestAccessibility()
								.then((next) =>
									setState((current) =>
										current ? { ...current, ...next } : current,
									),
								);
						}}
					>
						Request access
					</Button>
				</div>
			) : null}
			{settings.enabled && shortcutError ? (
				<p className="text-xs text-destructive">
					Capture shortcut unavailable: {shortcutError}
				</p>
			) : null}
		</SettingsSection>
	);
}
