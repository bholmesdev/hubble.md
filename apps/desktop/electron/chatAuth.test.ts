import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatGPTAuth } from "./chatAuth";

vi.mock("jose", async (original) => ({
	...(await original<typeof import("jose")>()),
	createRemoteJWKSet: vi.fn(),
}));

import { createRemoteJWKSet } from "jose";

const ISSUER = "https://auth.openai.com";
const realFetch = globalThis.fetch;
let folder: string;
let authorization: URL;
let subject = "user-a";
let scope = "openid resource.invoke chatgpt.tokens.use.direct";
let identityOverride: Record<string, unknown>;
let tokenStatus = 200;
let revokeStatus = 200;
let revocation: URLSearchParams | undefined;
let callbackClient = "oaiapp_test";
let exchange: URLSearchParams | undefined;
let callbackResponse: Promise<Response> | undefined;
let auth: ChatGPTAuth;
let options: ConstructorParameters<typeof ChatGPTAuth>[0];
let refreshReply: () => Promise<Response>;
let refreshes: URLSearchParams[];
let now: number;
let refreshIdentity: (subject: string) => Promise<string>;

beforeEach(async () => {
	folder = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-chat-auth-"));
	subject = "user-a";
	scope = "openid resource.invoke chatgpt.tokens.use.direct";
	identityOverride = {};
	tokenStatus = 200;
	revokeStatus = 200;
	revocation = undefined;
	callbackClient = "oaiapp_test";
	exchange = undefined;
	callbackResponse = undefined;
	refreshes = [];
	now = Date.now();
	vi.spyOn(Date, "now").mockImplementation(() => now);
	refreshReply = async () =>
		Response.json({
			access_token: "renewed-access",
			refresh_token: "rotated-refresh",
			token_type: "Bearer",
			expires_in: 3600,
			scope,
		});
	const { privateKey, publicKey } = await generateKeyPair("RS256");
	refreshIdentity = (subject) =>
		new SignJWT({})
			.setProtectedHeader({ alg: "RS256" })
			.setIssuer(ISSUER)
			.setAudience("oaiapp_test")
			.setSubject(subject)
			.setIssuedAt(Math.floor(now / 1000))
			.setExpirationTime(Math.floor(now / 1000) + 3600)
			.sign(privateKey);
	vi.mocked(createRemoteJWKSet).mockReturnValue(
		Object.assign(createLocalJWKSet({ keys: [await exportJWK(publicKey)] }), {
			coolingDown: false,
			fresh: true,
			reloading: false,
			reload: async () => {},
		}),
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
			if (url.endsWith("openid-configuration"))
				return Response.json({
					issuer: ISSUER,
					authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
					token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
					jwks_uri: `${ISSUER}/.well-known/jwks.json`,
					revocation_endpoint: `${ISSUER}/revoke`,
				});
			if (url.endsWith("/revoke")) {
				revocation = init?.body as URLSearchParams;
				return new Response(null, { status: revokeStatus });
			}
			if (!url.endsWith("/oauth/token")) throw new Error("Unexpected request");
			exchange = init?.body as URLSearchParams;
			if (exchange.get("grant_type") === "refresh_token") {
				refreshes.push(exchange);
				return refreshReply();
			}
			const id = await new SignJWT({
				nonce: authorization.searchParams.get("nonce"),
				...identityOverride,
			})
				.setProtectedHeader({ alg: "RS256" })
				.setIssuer(ISSUER)
				.setAudience(callbackClient)
				.setSubject(subject)
				.setIssuedAt()
				.setExpirationTime("1h")
				.sign(privateKey);
			return Response.json(
				{
					access_token: "secret-access",
					refresh_token: "secret-refresh",
					id_token: id,
					token_type: "Bearer",
					expires_in: 3600,
					scope,
				},
				{ status: tokenStatus },
			);
		}),
	);
	const key = randomBytes(32);
	options = {
		storagePath: path.join(folder, "connection.enc"),
		encrypt: (text) => {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
			return Buffer.concat([iv, cipher.getAuthTag(), body]);
		},
		decrypt: (bytes) => {
			const cipher = createDecipheriv(
				"aes-256-gcm",
				key,
				bytes.subarray(0, 12),
			);
			cipher.setAuthTag(bytes.subarray(12, 28));
			return Buffer.concat([
				cipher.update(bytes.subarray(28)),
				cipher.final(),
			]).toString("utf8");
		},
		openBrowser: async (url) => {
			authorization = new URL(url);
			const callback = new URL(authorization.searchParams.get("redirect_uri"));
			callback.search = new URLSearchParams({
				state: authorization.searchParams.get("state"),
				code: "one-time-code",
				client_id: callbackClient,
			}).toString();
			callbackResponse = realFetch(callback);
			void callbackResponse.catch(() => {});
		},
	};
	auth = new ChatGPTAuth(options);
});

afterEach(async () => {
	auth.cancel();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await fs.rm(folder, { recursive: true, force: true });
});

describe("ChatGPT public-client sign-in", () => {
	it("exchanges the issued client, exact loopback URI and PKCE; exposes no tokens", async () => {
		const account = await auth.signIn();
		expect(account).toMatchObject({ connected: true, sharing: true });
		expect(JSON.stringify(account)).not.toContain("secret-");
		expect(authorization.searchParams.get("client_id")).toBe(
			"dynamic_agent_client",
		);
		expect(authorization.searchParams.has("prompt")).toBe(false);
		expect(exchange.get("client_id")).toBe("oaiapp_test");
		expect(exchange.get("redirect_uri")).toBe(
			authorization.searchParams.get("redirect_uri"),
		);
		expect(
			createHash("sha256")
				.update(exchange.get("code_verifier"))
				.digest("base64url"),
		).toBe(authorization.searchParams.get("code_challenge"));
		expect(await auth.accessToken()).toBe("secret-access");
		expect((await fs.readFile(options.storagePath)).toString()).not.toContain(
			"secret-access",
		);
		expect(await new ChatGPTAuth(options).account()).toEqual(account);
	});

	it("allows a different account after sign-out and restart without reusing the previous registration", async () => {
		identityOverride = { email: "a@example.com" };
		expect(await auth.signIn()).toMatchObject({
			connected: true,
			label: "a@example.com",
		});
		const host = authorization.searchParams.get("ext_agent_host_id");
		await auth.disconnect();
		expect(revocation?.get("client_id")).toBe("oaiapp_test");
		expect(revocation?.get("token")).toBe("secret-refresh");
		auth = new ChatGPTAuth(options);
		subject = "user-b";
		callbackClient = "oaiapp_account_b";
		identityOverride = { email: "b@example.com" };
		expect(await auth.signIn()).toMatchObject({
			connected: true,
			label: "b@example.com",
		});
		expect(authorization.searchParams.get("client_id")).toBe(
			"dynamic_agent_client",
		);
		expect(authorization.searchParams.get("ext_agent_host_id")).toBe(host);
		expect(authorization.searchParams.get("agent_name_hint")).toBe("Hubble");
		expect(authorization.searchParams.has("id_token_hint")).toBe(false);
		expect(exchange?.get("client_id")).toBe("oaiapp_account_b");
		expect(await new ChatGPTAuth(options).account()).toMatchObject({
			connected: true,
			label: "b@example.com",
		});
	});

	it("requests consent explicitly when enabling missing plan permission", async () => {
		scope = "openid profile email";
		expect(await auth.signIn()).toMatchObject({
			connected: true,
			sharing: false,
		});
		await expect(auth.accessToken()).rejects.toThrow("not enabled");
		scope = "openid resource.invoke chatgpt.tokens.use.direct";
		expect(await auth.signIn()).toMatchObject({
			connected: true,
			sharing: true,
		});
		expect(authorization.searchParams.get("client_id")).toBe("oaiapp_test");
		expect(authorization.searchParams.get("prompt")).toBe("consent");
	});

	it("rejects an unrelated callback without exchanging a code", async () => {
		options.openBrowser = async (url) => {
			const target = new URL(url);
			const callback = new URL(target.searchParams.get("redirect_uri"));
			callback.search = "state=wrong&code=stolen&client_id=oaiapp_attacker";
			expect((await realFetch(callback)).status).toBe(400);
			auth.cancel();
		};
		await expect(auth.signIn()).rejects.toThrow("cancelled");
		expect(exchange).toBeUndefined();
		expect((await auth.account()).connected).toBe(false);
	});

	it("rejects a signed ID token with the wrong nonce", async () => {
		identityOverride = { nonce: "wrong" };
		await expect(auth.signIn()).rejects.toThrow("identity");
		expect((await auth.account()).connected).toBe(false);
	});

	it("checks the ID token signature", async () => {
		const { publicKey } = await generateKeyPair("RS256");
		vi.mocked(createRemoteJWKSet).mockReturnValue(
			Object.assign(createLocalJWKSet({ keys: [await exportJWK(publicKey)] }), {
				coolingDown: false,
				fresh: true,
				reloading: false,
				reload: async () => {},
			}),
		);
		await expect(auth.signIn()).rejects.toThrow();
		expect((await auth.account()).connected).toBe(false);
	});

	it("keeps registration after a failed one-time code exchange", async () => {
		tokenStatus = 400;
		await expect(auth.signIn()).rejects.toThrow("exchange failed");
		const response = callbackResponse;
		if (!response) throw Error("Missing callback response");
		expect(await (await response).text()).not.toContain(
			"Signed in successfully",
		);
		tokenStatus = 200;
		await auth.signIn();
		expect(authorization.searchParams.get("client_id")).toBe("oaiapp_test");
	});

	it("rejects a different account or issued client on reconnect", async () => {
		await auth.signIn();
		subject = "user-b";
		await expect(auth.signIn()).rejects.toThrow("identity");
		callbackClient = "oaiapp_other";
		await expect(auth.signIn()).rejects.toThrow("registration");
	});

	it("clears local tokens even if remote revocation fails", async () => {
		await auth.signIn();
		revokeStatus = 500;
		await expect(auth.disconnect()).rejects.toThrow("Signed out locally");
		expect((await new ChatGPTAuth(options).account()).connected).toBe(false);
		await expect(auth.accessToken()).rejects.toThrow("Sign in");
	});
});

it("recovers an unreadable connection by resetting without decrypting it", async () => {
	await fs.writeFile(options.storagePath, "Unreadable credentials");
	const decrypt = vi.spyOn(options, "decrypt");
	await expect(auth.account()).resolves.toMatchObject({
		connected: false,
		issue: "unreadable-credentials",
	});
	expect(decrypt).toHaveBeenCalledTimes(1);
	await auth.reset();
	expect(decrypt).toHaveBeenCalledTimes(1);
	await expect(fs.readFile(options.storagePath)).rejects.toMatchObject({
		code: "ENOENT",
	});
	await expect(auth.signIn()).resolves.toMatchObject({ connected: true });
});

describe("automatic token renewal", () => {
	it("renews near expiry, persists rotation across restart, and reuses the newest refresh token", async () => {
		await auth.signIn();
		const browser = vi.spyOn(options, "openBrowser");
		now += 3541_000;
		expect(await auth.accessToken()).toBe("renewed-access");
		expect(refreshes).toHaveLength(1);
		expect(Object.fromEntries(refreshes[0])).toEqual({
			grant_type: "refresh_token",
			client_id: "oaiapp_test",
			refresh_token: "secret-refresh",
			resource: "https://api.openai.com/v1",
		});
		expect(browser).not.toHaveBeenCalled();
		auth = new ChatGPTAuth(options);
		expect(await auth.accessToken()).toBe("renewed-access");
		expect(refreshes).toHaveLength(1);
		now += 3601_000;
		expect(await auth.account()).toMatchObject({
			connected: true,
			sharing: true,
		});
		expect(refreshes[1].get("refresh_token")).toBe("rotated-refresh");
		expect((await fs.readFile(options.storagePath)).toString()).not.toContain(
			"rotated-refresh",
		);
	});

	it("shares a renewal between concurrent status and token requests", async () => {
		await auth.signIn();
		now += 3601_000;
		let finish!: () => void;
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const reply = refreshReply;
		refreshReply = async () => {
			await gate;
			return reply();
		};
		const requests = [auth.account(), auth.accessToken(), auth.accessToken()];
		await vi.waitFor(() => expect(refreshes).toHaveLength(1));
		finish();
		expect(await Promise.all(requests)).toMatchObject([
			{ connected: true },
			"renewed-access",
			"renewed-access",
		]);
		expect(refreshes).toHaveLength(1);
	});

	it.each([
		"network",
		"server",
		"invalid_client",
	])("preserves expired credentials after a %s failure and retries without browser sign-in", async (failure) => {
		await auth.signIn();
		now += 3601_000;
		const before = await fs.readFile(options.storagePath);
		const goodReply = refreshReply;
		refreshReply = async () => {
			if (failure === "network") throw Error("offline");
			return Response.json(
				{ error: failure === "server" ? "invalid_grant" : "invalid_client" },
				{ status: failure === "server" ? 503 : 400 },
			);
		};
		expect(await auth.account()).toMatchObject({
			connected: false,
			label: "Chat account",
			issue: "refresh-unavailable",
		});
		expect(await fs.readFile(options.storagePath)).toEqual(before);
		await expect(auth.accessToken()).rejects.toThrow("try again");
		refreshReply = goodReply;
		expect(await auth.accessToken()).toBe("renewed-access");
	});

	it("continues using a valid token if early renewal fails", async () => {
		await auth.signIn();
		now += 3541_000;
		refreshReply = async () => {
			throw Error("offline");
		};
		expect(await auth.accessToken()).toBe("secret-access");
		const account = await auth.account();
		expect(account.connected).toBe(true);
		expect(account.issue).toBeUndefined();
	});

	it.each([
		"invalid_grant",
		"refresh_token_expired",
		"refresh_token_reused",
	])("returns to normal sign-in after %s while retaining registration", async (code) => {
		await auth.signIn();
		now += 3601_000;
		refreshReply = async () =>
			Response.json({ error: { code } }, { status: 400 });
		expect(await auth.account()).toMatchObject({
			connected: false,
			expiresAt: null,
		});
		await expect(auth.accessToken()).rejects.toThrow("Sign in");
		expect(refreshes).toHaveLength(1);
		await auth.signIn();
		expect(authorization.searchParams.get("client_id")).toBe("oaiapp_test");
	});

	it("does not let a pending renewal restore credentials after sign-out", async () => {
		await auth.signIn();
		now += 3601_000;
		let finish!: () => void;
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const reply = refreshReply;
		refreshReply = async () => {
			await gate;
			return reply();
		};
		const checking = auth.account();
		await vi.waitFor(() => expect(refreshes).toHaveLength(1));
		const signingOut = auth.disconnect();
		finish();
		await Promise.all([checking, signingOut]);
		expect(await new ChatGPTAuth(options).account()).toMatchObject({
			connected: false,
			expiresAt: null,
		});
	});

	it("keeps a rotated result for retry if saving it fails", async () => {
		await auth.signIn();
		now += 3601_000;
		const encrypt = vi.spyOn(options, "encrypt");
		encrypt.mockImplementationOnce(() => {
			throw Error("Permission denied");
		});
		expect(await auth.account()).toMatchObject({
			issue: "refresh-unavailable",
		});
		expect(await auth.accessToken()).toBe("renewed-access");
		expect(refreshes).toHaveLength(1);
		expect(await new ChatGPTAuth(options).accessToken()).toBe("renewed-access");
	});

	it("requires sign-in after expiry when no refresh token was granted", async () => {
		await auth.signIn();
		const saved = JSON.parse(
			options.decrypt(await fs.readFile(options.storagePath)),
		);
		delete saved.tokens.refresh;
		await fs.writeFile(
			options.storagePath,
			options.encrypt(JSON.stringify(saved)),
		);
		auth = new ChatGPTAuth(options);
		now += 3601_000;
		expect(await auth.account()).toMatchObject({
			connected: false,
			expiresAt: null,
		});
		expect(refreshes).toHaveLength(0);
	});

	it("retains the existing grant if refresh omits scope", async () => {
		await auth.signIn();
		now += 3601_000;
		refreshReply = async () =>
			Response.json({
				access_token: "renewed-access",
				refresh_token: "rotated-refresh",
				token_type: "Bearer",
				expires_in: 3600,
			});
		expect(await auth.account()).toMatchObject({
			connected: true,
			sharing: true,
		});
	});

	it("does not authorize an unverifiable refreshed identity", async () => {
		await auth.signIn();
		now += 3601_000;
		refreshReply = async () =>
			Response.json({
				access_token: "untrusted-access",
				refresh_token: "untrusted-refresh",
				id_token: "not-a-signed-identity",
				token_type: "Bearer",
				expires_in: 3600,
				scope,
			});
		await expect(auth.accessToken()).rejects.toThrow("Sign in");
		expect(
			JSON.parse(options.decrypt(await fs.readFile(options.storagePath)))
				.tokens,
		).toBeUndefined();
		await expect(new ChatGPTAuth(options).accessToken()).rejects.toThrow(
			"Sign in",
		);
	});

	it.each([
		0, 3541_000, 7201_000,
	])("resumes verification after a key-service failure and %ims away without reusing a consumed refresh token", async (elapsed) => {
		await auth.signIn();
		now += 3601_000;
		const reply = refreshReply;
		refreshReply = async () => {
			const body = await (await reply()).json();
			return Response.json({
				...body,
				id_token: await refreshIdentity("user-a"),
			});
		};
		vi.mocked(createRemoteJWKSet).mockImplementationOnce(() => {
			throw Error("Key service offline");
		});
		expect(await auth.account()).toMatchObject({
			issue: "refresh-unavailable",
		});
		now += elapsed;
		auth = new ChatGPTAuth(options);
		expect(await auth.accessToken()).toBe("renewed-access");
		expect(refreshes).toHaveLength(elapsed ? 2 : 1);
		if (elapsed)
			expect(refreshes[1].get("refresh_token")).toBe("rotated-refresh");
	});

	it("rejects a valid refreshed identity belonging to a different account", async () => {
		await auth.signIn();
		now += 3601_000;
		refreshReply = async () =>
			Response.json({
				access_token: "other-account-access",
				refresh_token: "other-account-refresh",
				id_token: await refreshIdentity("user-b"),
				token_type: "Bearer",
				expires_in: 3600,
				scope,
			});
		await expect(auth.accessToken()).rejects.toThrow("Sign in");
		expect(
			JSON.parse(options.decrypt(await fs.readFile(options.storagePath)))
				.tokens,
		).toBeUndefined();
	});
});
