import { api } from "@hubble.md/sync-backend";
import type { Doc } from "@hubble.md/sync-backend/types";
import { ConvexHttpClient } from "convex/browser";
import { useEffect, useState } from "react";
import { saveWorkspace } from "../connection/connection";
import { categorizeError, describeError } from "../connection/convex-error";

type Workspace = Doc<"workspaces">;

type Props = {
	url: string;
	onSelected: (id: string) => void;
	onDisconnect: () => void;
};

export function OpenWorkspaceScreen({ url, onSelected, onDisconnect }: Props) {
	const [client] = useState(() => new ConvexHttpClient(url));
	const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const select = (id: string) => {
		saveWorkspace(id);
		onSelected(id);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: select uses stable saveWorkspace + props
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const result = await client.query(api.sync.listWorkspaces, {});
				if (cancelled) return;
				setWorkspaces(result);
				if (result.length === 1) {
					select(result[0]._id);
				}
			} catch (err) {
				if (cancelled) return;
				setError(describeError(categorizeError(err)));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [client]);

	const handleCreate = async (event: React.FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		setBusy(true);
		setError(null);
		try {
			const id = await client.mutation(api.sync.createWorkspace, {
				name: trimmed,
			});
			select(id);
		} catch (err) {
			setError(describeError(categorizeError(err)));
			setBusy(false);
		}
	};

	const empty = workspaces !== null && workspaces.length === 0;

	return (
		<main className="flex h-dvh items-center justify-center bg-background text-foreground">
			<div className="flex w-full max-w-md flex-col gap-3 rounded-md border border-border bg-sidebar p-6">
				<div className="flex items-start justify-between gap-3">
					<div>
						<h1 className="m-0 text-base font-semibold">
							{empty ? "Name your Workspace" : "Open a Workspace"}
						</h1>
						<p className="m-0 mt-1 break-all text-xs text-muted-foreground">
							{url}
						</p>
					</div>
					<button
						type="button"
						onClick={onDisconnect}
						className="text-xs text-muted-foreground underline-offset-2 hover:underline"
					>
						Disconnect
					</button>
				</div>

				{error && (
					<p className="m-0 rounded-sm bg-muted px-2.5 py-1.5 text-xs text-destructive">
						{error}
					</p>
				)}

				{workspaces === null && !error && (
					<p className="m-0 text-xs text-muted-foreground">Loading…</p>
				)}

				{workspaces && workspaces.length > 1 && (
					<ul className="m-0 flex flex-col gap-1 p-0">
						{workspaces.map((w) => (
							<li key={w._id} className="list-none">
								<button
									type="button"
									onClick={() => select(w._id)}
									className="block w-full rounded-sm border border-border bg-background px-3 py-2 text-left text-sm hover:bg-sidebar-accent"
								>
									{w.name}
								</button>
							</li>
						))}
					</ul>
				)}

				{(empty || (workspaces && workspaces.length > 1)) && (
					<form onSubmit={handleCreate} className="flex flex-col gap-2">
						{!empty && (
							<p className="m-0 text-xs text-muted-foreground">
								Or create a new one
							</p>
						)}
						<input
							type="text"
							// biome-ignore lint/a11y/noAutofocus: deliberate — fresh-deployment onboarding
							autoFocus={empty}
							required
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Workspace name"
							disabled={busy}
							className="rounded-sm border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
						/>
						<button
							type="submit"
							disabled={busy}
							className="rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
						>
							{busy ? "Creating…" : "Create Workspace"}
						</button>
					</form>
				)}
			</div>
		</main>
	);
}
