import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod/v4";
import type { ChatAccount } from "../src/desktopApi/chat";

class UnreadableConnection extends Error {}

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES =
	"openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const savedSchema = z.object({
	hostId: z.string(),
	clientId: z.string().optional(),
	subject: z.string().optional(),
	label: z.string().optional(),
	tokens: z
		.object({
			access: z.string(),
			refresh: z.string().optional(),
			id: z.string(),
			expiresAt: z.number(),
			scopes: z.array(z.string()),
		})
		.optional(),
});
const tokenSchema = z.object({
	access_token: z.string().min(1),
	id_token: z.string().min(1),
	refresh_token: z.string().optional(),
	token_type: z.literal("Bearer"),
	expires_in: z.number().positive(),
	scope: z.string(),
});

type SavedAccount = z.infer<typeof savedSchema>;
type AuthOptions = {
	storagePath: string;
	encrypt: (text: string) => Buffer;
	decrypt: (bytes: Buffer) => string;
	openBrowser: (url: string) => Promise<void>;
};

/** A single local ChatGPT registration. Expired prototype sessions require sign-in. */
export class ChatGPTAuth {
	private saved: SavedAccount | undefined;
	private loading: Promise<SavedAccount> | undefined;
	private attempt: AbortController | undefined;

	constructor(private options: AuthOptions) {}

	async account(): Promise<ChatAccount> {
		let saved: SavedAccount;
		try {
			saved = await this.load();
		} catch (error) {
			if (!(error instanceof UnreadableConnection)) throw error;
			return {
				connected: false,
				sharing: false,
				label: null,
				expiresAt: null,
				issue: "unreadable-credentials",
			};
		}
		const connected = !!saved.tokens && saved.tokens.expiresAt > Date.now();
		return {
			connected,
			sharing:
				connected &&
				!!saved.tokens?.scopes.includes("chatgpt.tokens.use.direct"),
			label: saved.label ?? null,
			expiresAt: saved.tokens?.expiresAt ?? null,
		};
	}

	async accessToken() {
		const account = await this.account();
		if (!account.connected)
			throw new Error(
				"Sign in with ChatGPT to continue. Prototype sessions need reconnecting after an hour.",
			);
		if (!account.sharing)
			throw new Error(
				"ChatGPT plan usage is not enabled. Manage usage in ChatGPT, then reconnect.",
			);
		return (await this.load()).tokens.access;
	}

	async signIn(): Promise<ChatAccount> {
		if (this.attempt)
			throw new Error("A sign-in is already open. Finish or cancel it first.");
		const controller = new AbortController();
		this.attempt = controller;
		const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
		try {
			const saved = { ...(await this.load()) };
			const state = randomBytes(32).toString("base64url");
			const nonce = randomBytes(32).toString("base64url");
			const verifier = randomBytes(64).toString("base64url");
			const discovery = await this.discovery(controller.signal);
			const callback = await this.callback(state, controller.signal);
			try {
				const url = new URL(discovery.authorization_endpoint);
				url.search = new URLSearchParams({
					client_id: saved.clientId ?? "dynamic_agent_client",
					...(saved.clientId ? {} : { agent_name_hint: "Hubble" }),
					ext_agent_host_id: saved.hostId,
					...(saved.tokens ? { id_token_hint: saved.tokens.id } : {}),
					response_type: "code",
					redirect_uri: callback.uri,
					scope: SCOPES,
					resource: RESOURCE,
					state,
					nonce,
					code_challenge_method: "S256",
					code_challenge: createHash("sha256")
						.update(verifier)
						.digest("base64url"),
				}).toString();
				await this.options.openBrowser(url.href);
				const params = await callback.result;
				const clientId = params.get("client_id") ?? saved.clientId;
				if (
					!clientId ||
					clientId === "dynamic_agent_client" ||
					(saved.clientId && clientId !== saved.clientId)
				) {
					throw new Error(
						"ChatGPT returned an unexpected registration. Try signing in again.",
					);
				}
				// Keep registration even if its one-time code expires during exchange.
				saved.clientId = clientId;
				await this.save(saved);
				const response = await fetch(discovery.token_endpoint, {
					method: "POST",
					signal: controller.signal,
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "authorization_code",
						client_id: clientId,
						code: params.get("code"),
						code_verifier: verifier,
						redirect_uri: callback.uri,
						resource: RESOURCE,
					}),
				});
				if (!response.ok)
					throw new Error("ChatGPT sign-in exchange failed. Please reconnect.");
				const tokens = tokenSchema.parse(await response.json());
				const { payload } = await jwtVerify(
					tokens.id_token,
					createRemoteJWKSet(new URL(discovery.jwks_uri)),
					{
						issuer: ISSUER,
						audience: clientId,
						requiredClaims: ["sub", "exp", "iat"],
						clockTolerance: 5,
					},
				);
				if (
					payload.nonce !== nonce ||
					!payload.sub ||
					(saved.subject && saved.subject !== payload.sub)
				) {
					throw new Error("ChatGPT identity did not match this sign-in.");
				}
				controller.signal.throwIfAborted();
				const label =
					typeof payload.email === "string"
						? payload.email
						: typeof payload.name === "string"
							? payload.name
							: "ChatGPT account";
				const credentials = {
					access: tokens.access_token,
					refresh: tokens.refresh_token,
					id: tokens.id_token,
					expiresAt: Date.now() + tokens.expires_in * 1000,
					scopes: tokens.scope.split(/\s+/),
				};
				await this.save({
					...saved,
					subject: payload.sub,
					label,
					tokens: credentials,
				});
				return this.account();
			} finally {
				callback.close();
			}
		} finally {
			clearTimeout(timeout);
			if (this.attempt === controller) this.attempt = undefined;
		}
	}

	cancel() {
		this.attempt?.abort();
	}

	/** Recovery must not decrypt the credentials it is trying to discard. */
	async reset() {
		this.cancel();
		await fs.rm(this.options.storagePath, { force: true });
		this.saved = undefined;
		this.loading = undefined;
	}

	async disconnect() {
		this.cancel();
		const saved = { ...(await this.load()) };
		const tokens = saved.tokens;
		saved.tokens = undefined;
		await this.save(saved);
		if (!tokens?.refresh || !saved.clientId) return;
		try {
			const discovery = await this.discovery(AbortSignal.timeout(10_000));
			const response = await fetch(discovery.revocation_endpoint, {
				method: "POST",
				signal: AbortSignal.timeout(10_000),
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					token: tokens.refresh,
					token_type_hint: "refresh_token",
					client_id: saved.clientId,
				}),
			});
			if (!response.ok) throw new Error();
		} catch {
			throw new Error(
				"Signed out locally. Remote sign-out was not confirmed; disconnect Hubble in ChatGPT Settings → Usage.",
			);
		}
	}

	private load(): Promise<SavedAccount> {
		if (this.saved) return Promise.resolve(this.saved);
		if (!this.loading)
			this.loading = this.read().catch((error) => {
				this.loading = undefined;
				throw error;
			});
		return this.loading;
	}

	private async read() {
		try {
			this.saved = savedSchema.parse(
				JSON.parse(
					this.options.decrypt(await fs.readFile(this.options.storagePath)),
				),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new UnreadableConnection(
					"Your saved ChatGPT sign-in could not be opened. Reset the connection and sign in again.",
				);
			await this.save({ hostId: `urn:uuid:${randomUUID()}` });
		}
		return this.saved;
	}

	private async save(saved: SavedAccount) {
		await fs.mkdir(path.dirname(this.options.storagePath), { recursive: true });
		const temporary = `${this.options.storagePath}.tmp`;
		await fs.writeFile(temporary, this.options.encrypt(JSON.stringify(saved)), {
			mode: 0o600,
		});
		await fs.rename(temporary, this.options.storagePath);
		this.saved = saved;
	}

	private async discovery(signal: AbortSignal) {
		const response = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
			signal,
		});
		if (!response.ok)
			throw new Error("ChatGPT sign-in is unavailable. Try again.");
		const endpoint = z
			.url()
			.refine((value) => new URL(value).origin === ISSUER);
		return z
			.object({
				issuer: z.literal(ISSUER),
				authorization_endpoint: endpoint,
				token_endpoint: endpoint,
				jwks_uri: endpoint,
				revocation_endpoint: endpoint,
			})
			.parse(await response.json());
	}

	private async callback(state: string, signal: AbortSignal) {
		let resolve: (params: URLSearchParams) => void;
		let reject: (error: Error) => void;
		const result = new Promise<URLSearchParams>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		// Browser launch may fail before the callback promise is awaited.
		void result.catch(() => {});
		let used = false;
		const server = createServer((request, response) => {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (
				request.method !== "GET" ||
				url.pathname !== "/auth/callback" ||
				used ||
				url.searchParams.get("state") !== state
			) {
				response.writeHead(400).end("Invalid sign-in callback.");
				return;
			}
			used = true;
			response.setHeader("Content-Type", "text/plain; charset=utf-8");
			response.setHeader("Cache-Control", "no-store");
			if (url.searchParams.has("error") || !url.searchParams.get("code")) {
				response.end("Sign-in was declined. Return to Hubble.");
				reject(new Error("ChatGPT sign-in was declined. You can try again."));
			} else {
				response.end(
					"Sign-in received. Return to Hubble to finish connecting.",
				);
				resolve(url.searchParams);
			}
		});
		const abort = () => {
			reject(new Error("ChatGPT sign-in cancelled or timed out."));
			server.close();
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", resolve);
			});
			signal.throwIfAborted();
		} catch (error) {
			signal.removeEventListener("abort", abort);
			server.close();
			throw error;
		}
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Could not start ChatGPT sign-in.");
		return {
			uri: `http://127.0.0.1:${address.port}/auth/callback`,
			result,
			close: () => {
				signal.removeEventListener("abort", abort);
				server.close();
			},
		};
	}
}
