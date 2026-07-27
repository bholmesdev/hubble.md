import { Button, Switch } from "@hubble.md/ui";
import { desktopApi } from "../desktopApi";
import type { TelemetryChoice, TelemetryConsent } from "../desktopApi/types";
import { SettingsSection } from "./SettingsDialog";

const telemetryDocUrl =
	"https://github.com/bholmesdev/hubble.md/blob/main/TELEMETRY.md";

function WhatsCollectedLink() {
	return (
		<button
			type="button"
			className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
			onClick={() => void desktopApi.openExternalUrl(telemetryDocUrl)}
		>
			See what's collected
		</button>
	);
}

export function TelemetryConsentCallout({
	onChoose,
}: {
	onChoose: (choice: TelemetryChoice) => void;
}) {
	return (
		<div className="rounded-md border border-primary/20 bg-primary/8 p-3">
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-1">
					<p className="text-[11px] font-semibold text-foreground">
						Anonymous usage data
					</p>
					<p className="text-[11px] text-foreground">
						Hubble collects anonymous data about general usage. This information
						helps us improve the app. <WhatsCollectedLink />
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={() => onChoose("enabled")}>
						OK
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onChoose("declined")}
					>
						Disable
					</Button>
				</div>
			</div>
		</div>
	);
}

export function TelemetrySettingsSection({
	consent,
	onChoose,
}: {
	consent: TelemetryConsent;
	onChoose: (choice: TelemetryChoice) => void;
}) {
	return (
		<SettingsSection
			title="Usage statistics"
			description={
				<>
					Share anonymous data about general usage that helps us improve the
					app. <WhatsCollectedLink />
				</>
			}
			action={
				<Switch
					aria-label="Share usage data"
					checked={consent !== "declined"}
					onCheckedChange={(checked) =>
						onChoose(checked ? "enabled" : "declined")
					}
				/>
			}
		/>
	);
}
