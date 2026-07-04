import { api } from "@hubble.md/sync-backend";
import { ConvexHttpClient } from "convex/browser";
import { useState } from "react";
import { saveConnection } from "../connection/connection";
import { categorizeError, describeError } from "../connection/convex-error";
import { ensureDeviceId } from "../connection/deviceId";

type Props = {
	onConnected: (url: string, token: string) => void;
};

export function ConnectScreen({ onConnected }: Props) {
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const trimmed = url.trim();
		const trimmedToken = token.trim();
		if (!trimmed || !trimmedToken) return;
		setBusy(true);
		setError(null);
		try {
			const client = new ConvexHttpClient(trimmed);
			await client.query(api.sync.getWorkspace, {
				auth: { token: trimmedToken },
				name: "__hubble_connect_probe__",
			});
			saveConnection(trimmed, trimmedToken);
			ensureDeviceId();
			onConnected(trimmed, trimmedToken);
		} catch (err) {
			setError(describeError(categorizeError(err)));
		} finally {
			setBusy(false);
		}
	};

	return (
		<main className="flex h-dvh items-center justify-center bg-background text-foreground">
			<form
				onSubmit={handleSubmit}
				className="flex w-full max-w-md flex-col gap-3 rounded-md border border-border bg-sidebar p-6"
			>
				<div>
					<h1 className="m-0 text-base font-semibold">Connect to hubble.md</h1>
					<p className="m-0 mt-1 text-xs text-muted-foreground">
						Paste your Convex deployment URL and device token.
					</p>
				</div>
				<input
					type="url"
					inputMode="url"
					// biome-ignore lint/a11y/noAutofocus: deliberate — single-field connect screen
					autoFocus
					required
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="https://your-deployment.convex.cloud"
					disabled={busy}
					className="rounded-sm border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
				/>
				<input
					type="password"
					required
					value={token}
					onChange={(event) => setToken(event.target.value)}
					placeholder="hbl_write_..."
					disabled={busy}
					className="rounded-sm border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
				/>
				{error && (
					<p className="m-0 rounded-sm bg-muted px-2.5 py-1.5 text-xs text-destructive">
						{error}
					</p>
				)}
				<button
					type="submit"
					disabled={busy}
					className="rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
				>
					{busy ? "Connecting…" : "Connect"}
				</button>
			</form>
		</main>
	);
}
