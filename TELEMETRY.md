# Hubble Telemetry

Hubble collects completely anonymous telemetry data about general usage. Telemetry is on by default, and you may opt out at any time.

## Why Is Telemetry Collected?

Telemetry shows which parts of the app people actually use (like HTML Apps) and which platforms and versions to prioritize for fixes, without requiring accounts or sign-ins.

## What Is Being Collected?

The following events are sent, directly to [Plausible](https://plausible.io):

| Event | Sent when |
| --- | --- |
| `Desktop Active` | You opened the desktop app that day |
| `HTML App Used` | You opened an HTML App that day |

Every event carries the same properties:

| Property | Example | Notes |
| --- | --- | --- |
| `installationId` | `123e4567-e89b-42d3-a456-426614174000` | Random UUID. Not derived from your machine, network, or any account. |
| `localDate` | `2026-07-19` | The day the activity happened, in your local time zone. |
| `version` | `0.1.21` | Hubble version. |
| `os` | `darwin` | Operating system. |
| `arch` | `arm64` | CPU architecture. |

An example event payload:

```json
{
  "domain": "hubble.md",
  "name": "Desktop Active",
  "url": "https://hubble.md/telemetry/desktop",
  "interactive": false,
  "props": {
    "installationId": "123e4567-e89b-42d3-a456-426614174000",
    "localDate": "2026-07-19",
    "version": "0.1.21",
    "os": "darwin",
    "arch": "arm64"
  }
}
```

The `url` is a field Plausible requires to group events on its dashboard. Nothing is hosted or fetched at that address.

## What About Sensitive Data?

Note contents, file names, and file paths are never collected and never leave your device.

The installation ID identifies an install, not a person: it is generated randomly and nothing links it to you. Like any HTTP request, delivery exposes your IP address and user agent to [Plausible](https://plausible.io) during transport. Plausible's [data policy](https://plausible.io/data-policy) describes how it handles that data; it does not store raw IP addresses.

## Will This Data Be Shared?

Events are stored indefinitely in Hubble's [Plausible](https://plausible.io) account and are used only to guide Hubble development.

## How Do I Opt Out?

Choose "Disable" on the first-launch notice, or turn off "Share usage data" at any time in Settings under "Usage statistics".

Because telemetry is on by default, an event may be sent before you respond to the first-launch notice. Opting out stops all future events and deletes the installation ID and all pending events from your device. Opting back in generates a fresh ID.

## Implementation

- [`apps/desktop/electron/telemetry.ts`](apps/desktop/electron/telemetry.ts): consent, event queue, and delivery
- [`apps/desktop/src/components/TelemetrySection.tsx`](apps/desktop/src/components/TelemetrySection.tsx): consent UI
