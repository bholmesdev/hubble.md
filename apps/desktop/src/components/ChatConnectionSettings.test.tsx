// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatAccount } from "../desktopApi/chat";
import type { DesktopApi } from "../desktopApi/types";

const signedOut: ChatAccount = {
	connected: false,
	sharing: false,
	label: null,
	expiresAt: null,
};
const signedIn: ChatAccount = {
	connected: true,
	sharing: true,
	label: "test@example.com",
	expiresAt: Date.now() + 3600000,
};
let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function setup(account = signedOut) {
	vi.resetModules();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const api = {
		chatAccount: vi.fn(async () => account),
		chatSignIn: vi.fn(async () => signedIn),
		chatCancelSignIn: vi.fn(async () => {}),
		chatReset: vi.fn(async () => {}),
		chatDisconnect: vi.fn(async () => {
			account = signedOut;
		}),
		openExternalUrl: vi.fn(async () => {}),
	};
	window.desktopApi = api as unknown as DesktopApi;
	const { refreshChatConnection, chatConnection } = await import(
		"../store/chatConnection"
	);
	const { ChatConnectionSettings } = await import("./ChatConnectionSettings");
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(<ChatConnectionSettings />);
		await refreshChatConnection();
	});
	return { api, host, chatConnection };
}
function button(label: string) {
	const element = [...document.querySelectorAll("button")].find(
		(item) => item.textContent === label,
	);
	if (!element) throw Error(`Missing button: ${label}`);
	return element;
}

it("connects, shows the account, and signs out through the desktop bridge", async () => {
	const { api, host } = await setup();
	expect(host.textContent).not.toContain("Manage usage");
	await act(async () => button("Sign in with ChatGPT").click());
	expect(api.chatSignIn).toHaveBeenCalledOnce();
	expect(host.textContent).toContain("test@example.com");
	expect(button("Manage usage").disabled).toBe(false);
	expect(host.textContent).not.toContain("Reconnect");
	expect(host.textContent).not.toContain("Enable access");
	await act(async () => button("Sign out").click());
	expect(api.chatDisconnect).toHaveBeenCalledOnce();
	expect(host.textContent).not.toContain("test@example.com");
	expect(host.textContent).not.toContain("Manage usage");
	expect(button("Sign in with ChatGPT").disabled).toBe(false);
});

it("keeps cancellation available while sign-in is pending", async () => {
	const { api } = await setup();
	let reject!: (error: Error) => void;
	api.chatSignIn.mockImplementationOnce(
		() =>
			new Promise((_resolve, no) => {
				reject = no;
			}),
	);
	api.chatCancelSignIn.mockImplementationOnce(async () =>
		reject(Error("Sign-in cancelled.")),
	);
	await act(async () => button("Sign in with ChatGPT").click());
	await act(async () => button("Cancel sign-in").click());
	expect(api.chatCancelSignIn).toHaveBeenCalledOnce();
	expect(button("Sign in with ChatGPT").disabled).toBe(false);
	expect(document.querySelector('[role="alert"]')?.textContent).toContain(
		"Sign-in failed. Please try again.",
	);
});

it("shows unreadable credentials as signed out and replaces them on sign-in", async () => {
	const { api, host } = await setup({
		...signedOut,
		issue: "unreadable-credentials",
	});
	expect(document.querySelector('[role="alert"]')).toBeNull();
	expect(api.chatReset).not.toHaveBeenCalled();
	await act(async () => button("Sign in with ChatGPT").click());
	expect(api.chatReset).toHaveBeenCalledOnce();
	expect(api.chatSignIn).toHaveBeenCalledOnce();
	expect(host.textContent).toContain("test@example.com");
});

it("retains the real account state when local sign-out fails", async () => {
	const { api, host } = await setup(signedIn);
	api.chatDisconnect.mockRejectedValueOnce(Error("Could not save sign-out."));
	await act(async () => button("Sign out").click());
	expect(host.textContent).toContain("test@example.com");
	expect(button("Sign out").disabled).toBe(false);
	expect(host.textContent).toContain("Something went wrong. Please try again.");
	expect(host.textContent).not.toContain("Could not save sign-out.");
});

it("keeps the existing connection after a failed permission request", async () => {
	const { api, host } = await setup({ ...signedIn, sharing: false });
	api.chatSignIn.mockRejectedValueOnce(Error("Sign-in cancelled."));
	await act(async () => button("Enable access").click());
	expect(host.textContent).toContain("test@example.com");
	expect(button("Sign out").disabled).toBe(false);
	expect(host.textContent).toContain("Sign-in failed. Please try again.");
});

it("requests plan access without signing out and hides the action after permission is granted", async () => {
	const { api, host } = await setup({ ...signedIn, sharing: false });
	expect(host.textContent).toContain("Hubble doesn’t have permission");
	await act(async () => button("Enable access").click());
	expect(api.chatSignIn).toHaveBeenCalledOnce();
	expect(api.chatDisconnect).not.toHaveBeenCalled();
	expect(api.chatReset).not.toHaveBeenCalled();
	expect(host.textContent).not.toContain("Enable access");
	expect(host.textContent).not.toContain("Reconnect");
	expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("recovers pending browser sign-in after a renderer reload", async () => {
	vi.useFakeTimers();
	const { api, host } = await setup({
		...signedOut,
		signingIn: true,
		busy: true,
	});
	expect(button("Cancel sign-in").disabled).toBe(false);
	api.chatAccount.mockResolvedValue(signedIn);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(host.textContent).toContain("test@example.com");
	expect(button("Sign out").disabled).toBe(false);
});

it("retries temporary renewal failures without opening browser sign-in", async () => {
	const { api, host } = await setup({
		...signedIn,
		connected: false,
		sharing: false,
		expiresAt: Date.now() - 1000,
		issue: "refresh-unavailable",
	});
	expect(host.textContent).toContain("Something went wrong. Please try again.");
	api.chatAccount.mockResolvedValue(signedIn);
	await act(async () => button("Try again").click());
	expect(api.chatSignIn).not.toHaveBeenCalled();
	expect(api.chatReset).not.toHaveBeenCalled();
	expect(host.textContent).toContain("test@example.com");
	expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("keeps a contextual recovery action if remote sign-out could not be confirmed", async () => {
	const { api, host } = await setup(signedIn);
	api.chatDisconnect.mockImplementationOnce(async () => {
		api.chatAccount.mockResolvedValue(signedOut);
		throw Error("Signed out locally. Remote sign-out was not confirmed.");
	});
	await act(async () => button("Sign out").click());
	expect(host.textContent).not.toContain("Manage usage");
	api.openExternalUrl.mockRejectedValueOnce(Error("Browser unavailable"));
	await act(async () => button("Open ChatGPT settings").click());
	await act(async () => button("Open ChatGPT settings").click());
	expect(api.openExternalUrl).toHaveBeenCalledWith(
		"https://chatgpt.com/settings/usage",
	);
});
