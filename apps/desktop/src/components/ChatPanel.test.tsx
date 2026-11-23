// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatDelta, ChatResult } from "../desktopApi/chat";
import { ChatPanel, TOGGLE_CHAT_EVENT } from "./ChatPanel";

const mocks = vi.hoisted(() => ({
	api: {
		chatAccount: vi.fn(),
		chatModels: vi.fn(),
		chatSend: vi.fn(),
		chatStop: vi.fn(),
		onChatDelta: vi.fn(),
	},
	selection: { text: "Unsaved passage A", empty: false },
}));
vi.mock("../desktopApi", () => ({ desktopApi: mocks.api }));
vi.mock("@hubble.md/editor", () => ({
	selectionToMarkdown: (selection: { text: string }) => selection.text,
}));
vi.mock("@hubble.md/ui", () => ({
	Button: ({
		variant: _variant,
		size: _size,
		...props
	}: Record<string, unknown>) => <button type="button" {...props} />,
	getActiveEditor: () => ({ state: { selection: mocks.selection } }),
}));
let host: HTMLDivElement;
let root: Root;
let delta: (event: ChatDelta) => void;
let finish: (result: ChatResult) => void;

beforeEach(async () => {
	vi.clearAllMocks();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.selection.text = "Unsaved passage A";
	mocks.api.chatAccount.mockResolvedValue({
		connected: true,
		sharing: true,
		label: "Test account",
		expiresAt: Date.now() + 3600000,
	});
	mocks.api.chatModels.mockResolvedValue([
		{ slug: "model", name: "Available model" },
	]);
	mocks.api.onChatDelta.mockImplementation((callback) => {
		delta = callback;
		return vi.fn();
	});
	mocks.api.chatSend.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	mocks.api.chatStop.mockResolvedValue(undefined);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root.render(<ChatPanel filePath="/notes/note.md" />));
	await act(async () => window.dispatchEvent(new Event(TOGGLE_CHAT_EVENT)));
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

function button(text: string) {
	const element = [...host.querySelectorAll("button")].find(
		(button) => button.textContent === text,
	);
	if (!element) throw new Error(`Missing button: ${text}`);
	return element;
}

it("freezes selected text before composer focus and streams the matching reply", async () => {
	await act(async () => button("Add selection").click());
	mocks.selection.text = "New selection B";
	await act(async () => button("Send").click());
	const request = mocks.api.chatSend.mock.calls[0][0];
	expect(request.messages[0].quotes[0]).toMatchObject({
		source: "note.md",
		text: "Unsaved passage A",
	});
	await act(async () => delta({ id: "another-request", text: "Wrong reply" }));
	expect(host.textContent).not.toContain("Wrong reply");
	await act(async () => delta({ id: request.id, text: "Streamed reply" }));
	expect(host.textContent).toContain("Streamed reply");
	await act(async () => finish({ status: "complete", text: "Finished reply" }));
	expect(host.textContent).toContain("Finished reply");
	expect(button("Send")).toBeDefined();
});

it("stops the request when its folder scope unmounts and ignores late output", async () => {
	await act(async () => button("Add selection").click());
	await act(async () => button("Send").click());
	const request = mocks.api.chatSend.mock.calls[0][0];
	await act(async () =>
		root.render(<ChatPanel key="another-folder" filePath="/other/file.md" />),
	);
	expect(mocks.api.chatStop).toHaveBeenCalledWith(request.id);
	await act(async () =>
		finish({ status: "complete", text: "Old folder reply" }),
	);
	await act(async () => window.dispatchEvent(new Event(TOGGLE_CHAT_EVENT)));
	expect(host.textContent).not.toContain("Old folder reply");
	expect(host.textContent).not.toContain("Unsaved passage A");
});
