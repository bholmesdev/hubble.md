import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import type {
	TelemetryChoice,
	TelemetryConsent,
} from "../src/desktopApi/types";
import { dedupeRuns, sequential } from "../src/lib/concurrency";

export const telemetryEventNames = {
	desktopActive: "Desktop Active",
	htmlAppUsed: "HTML App Used",
} as const;

type DailyActivity = {
	activityDelivered: boolean;
	htmlAppUsed: boolean;
	htmlAppDelivered: boolean;
};

type PersistedTelemetry = {
	consent: TelemetryConsent;
	installationId?: string;
	days: Record<string, DailyActivity>;
};

const persistedSchema = z
	.object({
		consent: z.enum(["enabled", "declined", "unset"]),
		installationId: z.uuid().optional(),
		days: z.record(
			z.string(),
			z.object({
				activityDelivered: z.boolean(),
				htmlAppUsed: z.boolean(),
				htmlAppDelivered: z.boolean(),
			}),
		),
	})
	.strict();

const emptyState = (): PersistedTelemetry => ({ consent: "unset", days: {} });

// Undelivered days older than this are dropped instead of retried, so
// telemetry.json stays bounded even when sending never succeeds.
const retentionDays = 30;

export type TelemetryManagerOptions = {
	statePath: string;
	endpoint: string;
	domain: string;
	canSend: boolean;
	version: string;
	userAgent: () => string | undefined;
	fetch?: typeof globalThis.fetch;
	now?: () => Date;
	installationId?: () => string;
	platform?: NodeJS.Platform;
	arch?: string;
};

export class TelemetryManager {
	private state: PersistedTelemetry = emptyState();
	private readonly fetch: typeof globalThis.fetch;
	private readonly now: () => Date;
	private readonly newInstallationId: () => string;
	private activeRequest: AbortController | null = null;

	readonly flush = dedupeRuns(() => this.flushPending());

	private readonly write = sequential(async (content: string) => {
		await fs.mkdir(path.dirname(this.options.statePath), { recursive: true });
		await fs.writeFile(this.options.statePath, content, { mode: 0o600 });
	});

	constructor(private readonly options: TelemetryManagerOptions) {
		this.fetch = options.fetch ?? globalThis.fetch;
		this.now = options.now ?? (() => new Date());
		this.newInstallationId = options.installationId ?? randomUUID;
	}

	async load() {
		try {
			const parsed = persistedSchema.safeParse(
				JSON.parse(await fs.readFile(this.options.statePath, "utf8")),
			);
			this.state = parsed.success ? parsed.data : emptyState();
		} catch {
			this.state = emptyState();
		}
		void this.flush();
	}

	getConsent(): TelemetryConsent {
		return this.state.consent;
	}

	async setConsent(consent: TelemetryChoice) {
		this.state.consent = consent;
		if (consent === "declined") {
			this.activeRequest?.abort();
			delete this.state.installationId;
			this.state.days = {};
		}
		await this.persist();
		if (consent === "enabled") void this.flush();
		return this.getConsent();
	}

	async recordActivity(usedHtmlApp: boolean) {
		// Opt-out model: "unset" (notice shown but not yet acknowledged) still
		// collects; only an explicit decline stops it.
		if (this.state.consent === "declined") return;
		const localDate = formatLocalDate(this.now());
		const day = this.state.days[localDate] ?? {
			activityDelivered: false,
			htmlAppUsed: false,
			htmlAppDelivered: false,
		};
		// Window focus calls this often; only touch disk when the day gains
		// something new. Still flush so undelivered days retry.
		const changed =
			!this.state.days[localDate] || (usedHtmlApp && !day.htmlAppUsed);
		day.htmlAppUsed ||= usedHtmlApp;
		this.state.days[localDate] = day;
		if (changed) {
			await this.persist();
			// A decline during the persist wins: it already cleared days and queued
			// the final write, so don't flush what it wiped.
			if (this.getConsent() === "declined") return;
		}
		await this.flush();
	}

	private async flushPending() {
		const pruned = this.pruneDays();
		const hasPending = Object.values(this.state.days).some(
			(day) =>
				!day.activityDelivered || (day.htmlAppUsed && !day.htmlAppDelivered),
		);
		if (
			this.state.consent === "declined" ||
			!this.options.canSend ||
			!hasPending
		) {
			if (pruned) await this.persist();
			return;
		}
		// Minting only when something is deliverable keeps an untouched install
		// from ever persisting an id.
		this.state.installationId ??= this.newInstallationId();
		await this.persist();

		for (const [localDate, activity] of Object.entries(
			this.state.days,
		).sort()) {
			// Consent can flip to "declined" while a send is in flight.
			if (this.getConsent() === "declined") return;
			if (!activity.activityDelivered) {
				activity.activityDelivered = await this.send(
					telemetryEventNames.desktopActive,
					localDate,
				);
				await this.persist();
			}
			if (activity.htmlAppUsed && !activity.htmlAppDelivered) {
				activity.htmlAppDelivered = await this.send(
					telemetryEventNames.htmlAppUsed,
					localDate,
				);
				await this.persist();
			}
		}
	}

	private pruneDays() {
		const now = this.now();
		const today = formatLocalDate(now);
		const cutoff = new Date(now);
		cutoff.setDate(cutoff.getDate() - retentionDays);
		const cutoffDate = formatLocalDate(cutoff);
		let pruned = false;
		for (const [localDate, day] of Object.entries(this.state.days)) {
			const delivered =
				day.activityDelivered && (!day.htmlAppUsed || day.htmlAppDelivered);
			// Today's delivered day must stay so it is not re-sent this session.
			if (localDate >= today) continue;
			if (!delivered && localDate >= cutoffDate) continue;
			delete this.state.days[localDate];
			pruned = true;
		}
		return pruned;
	}

	private async send(name: string, localDate: string) {
		try {
			this.activeRequest = new AbortController();
			const userAgent = this.options.userAgent();
			const response = await this.fetch(this.options.endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(userAgent ? { "user-agent": userAgent } : {}),
				},
				body: JSON.stringify({
					domain: this.options.domain,
					name,
					// Plausible's event API requires a url; nothing is fetched. It only
					// scopes events to the dashboard, grouped under this pseudo-page.
					url: `https://${this.options.domain}/telemetry/desktop`,
					interactive: false,
					props: {
						installationId: this.state.installationId,
						localDate,
						version: this.options.version,
						os: this.options.platform ?? os.platform(),
						arch: this.options.arch ?? os.arch(),
					},
				}),
				signal: this.activeRequest.signal,
			});
			return (
				response.ok &&
				response.headers.get("x-plausible-dropped") !== "1" &&
				this.state.consent !== "declined"
			);
		} catch {
			return false;
		} finally {
			this.activeRequest = null;
		}
	}

	private async persist() {
		await this.write(`${JSON.stringify(this.state, null, 2)}\n`);
	}
}

export function formatLocalDate(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
