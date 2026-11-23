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
let callbackClient = "oaiapp_test";
let exchange: URLSearchParams | undefined;
let auth: ChatGPTAuth;
let options: ConstructorParameters<typeof ChatGPTAuth>[0];

beforeEach(async () => {
	folder = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-chat-auth-"));
	subject = "user-a";
	scope = "openid resource.invoke chatgpt.tokens.use.direct";
	identityOverride = {};
	tokenStatus = 200;
	revokeStatus = 200;
	callbackClient = "oaiapp_test";
	exchange = undefined;
	const { privateKey, publicKey } = await generateKeyPair("RS256");
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
			if (url.endsWith("/revoke"))
				return new Response(null, { status: revokeStatus });
			if (!url.endsWith("/oauth/token")) throw new Error("Unexpected request");
			exchange = init?.body as URLSearchParams;
			const id = await new SignJWT({
				nonce: authorization.searchParams.get("nonce"),
				...identityOverride,
			})
				.setProtectedHeader({ alg: "RS256" })
				.setIssuer(ISSUER)
				.setAudience("oaiapp_test")
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
			await realFetch(callback);
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

	it("retains host and issued registration across sign-out and reconnect", async () => {
		await auth.signIn();
		const host = authorization.searchParams.get("ext_agent_host_id");
		await auth.disconnect();
		await auth.signIn();
		expect(authorization.searchParams.get("client_id")).toBe("oaiapp_test");
		expect(authorization.searchParams.get("ext_agent_host_id")).toBe(host);
		expect(authorization.searchParams.has("agent_name_hint")).toBe(false);
		expect(authorization.searchParams.has("id_token_hint")).toBe(false);
	});

	it("does not infer plan permission from a successful identity login", async () => {
		scope = "openid profile email";
		expect(await auth.signIn()).toMatchObject({
			connected: true,
			sharing: false,
		});
		await expect(auth.accessToken()).rejects.toThrow("not enabled");
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
