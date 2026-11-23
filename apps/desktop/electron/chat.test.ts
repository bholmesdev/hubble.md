import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_CONTEXT_LIMIT, type ChatRequest } from "../src/desktopApi/chat";
import { setupChatIpc } from "./chat";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (event: unknown, input?: unknown) => unknown>(),
	create: vi.fn(),
	token: vi.fn(),
	account: vi.fn(),
	cancel: vi.fn(),
	disconnect: vi.fn(),
	signIn: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp/hubble-chat-test", on: vi.fn() },
	ipcMain: {
		handle: (
			name: string,
			callback: (event: unknown, input?: unknown) => unknown,
		) => mocks.handlers.set(name, callback),
	},
	safeStorage: {},
	shell: {},
}));
vi.mock("./chatAuth", () => ({
	ChatGPTAuth: class {
		accessToken = mocks.token;
		account = mocks.account;
		cancel = mocks.cancel;
		disconnect = mocks.disconnect;
		signIn = mocks.signIn;
	},
}));
vi.mock("openai", async (original) => {
	const { default: OpenAI } = await original<typeof import("openai")>();
	return {
		default: class extends OpenAI {
			constructor(options: ConstructorParameters<typeof OpenAI>[0]) {
				super(options);
				this.responses.create = mocks.create;
			}
		},
	};
});

let sender: EventEmitter & {
	mainFrame: object;
	send: ReturnType<typeof vi.fn>;
	isDestroyed: () => boolean;
};
let event: IpcMainInvokeEvent;

beforeEach(() => {
	vi.clearAllMocks();
	sender = Object.assign(new EventEmitter(), {
		mainFrame: {},
		send: vi.fn(),
		isDestroyed: () => false,
	});
	event = {
		sender,
		senderFrame: sender.mainFrame,
	} as unknown as IpcMainInvokeEvent;
	mocks.handlers.clear();
	mocks.token.mockResolvedValue("test-oauth-token");
	setupChatIpc(() => sender as unknown as WebContents);
});
afterEach(() => vi.restoreAllMocks());

function call(name: string, input?: unknown) {
	return mocks.handlers.get(`desktop:chat-${name}`)(event, input);
}
function request(): ChatRequest {
	return {
		id: crypto.randomUUID(),
		model: "account-model",
		messages: [
			{
				id: "u1",
				role: "user",
				text: "Explain this",
				status: "complete",
				quotes: [
					{ id: "q1", source: "note.md", text: "Unsaved selected text" },
				],
			},
		],
	};
}
function stream(events: object[]) {
	return (async function* () {
		for (const event of events) yield event;
	})();
}

describe("ChatGPT IPC and Responses", () => {
	it("sends explicit history and quotes with storage off, then streams only to its owner", async () => {
		mocks.create.mockResolvedValue(
			stream([
				{ type: "response.output_text.delta", delta: "Hello" },
				{ type: "response.completed" },
			]),
		);
		const input = request();
		expect(await call("send", input)).toEqual({
			status: "complete",
			text: "Hello",
		});
		const [body] = mocks.create.mock.calls[0];
		expect(body).toMatchObject({
			model: "account-model",
			store: false,
			stream: true,
		});
		expect(body.input).toEqual([
			{
				role: "user",
				content:
					"Explain this\n\nQuoted document passage 1 (note.md):\nUnsaved selected text",
			},
		]);
		expect(body).not.toHaveProperty("previous_response_id");
		expect(body).not.toHaveProperty("tools");
		expect(sender.send).toHaveBeenCalledWith("desktop:chat-delta", {
			id: input.id,
			text: "Hello",
		});
	});

	it("rejects iframe callers before reading credentials", () => {
		event = { ...event, senderFrame: {} } as IpcMainInvokeEvent;
		expect(() => call("account")).toThrow("Hubble window");
		expect(mocks.account).not.toHaveBeenCalled();
	});

	it("does not treat partial output as success or include failed assistant turns later", async () => {
		mocks.create.mockResolvedValue(
			stream([
				{ type: "response.output_text.delta", delta: "Partial" },
				{
					type: "response.failed",
					response: {
						error: { code: "subscription_sharing_usage_limit_exceeded" },
					},
				},
			]),
		);
		expect(await call("send", request())).toMatchObject({
			status: "failed",
			text: "Partial",
			error: expect.stringContaining("Manage usage"),
		});
		const input = request();
		input.messages.unshift({
			id: "failed",
			role: "assistant",
			status: "failed",
			text: "Do not send this",
			quotes: [],
		});
		mocks.create.mockResolvedValue(stream([{ type: "response.completed" }]));
		await call("send", input);
		expect(JSON.stringify(mocks.create.mock.calls[1][0].input)).not.toContain(
			"Do not send this",
		);
	});

	it("reports a truncated stream as failed", async () => {
		mocks.create.mockResolvedValue(
			stream([{ type: "response.output_text.delta", delta: "Partial" }]),
		);
		expect(await call("send", request())).toMatchObject({
			status: "failed",
			text: "Partial",
		});
	});

	it("cancels requests on stop and renderer navigation, without replaying them", async () => {
		for (const action of ["stop", "navigation"]) {
			let release: (events: AsyncGenerator<object>) => void;
			mocks.create.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve;
					}),
			);
			const input = request();
			const response = call("send", input);
			await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled());
			await expect(call("send", request())).rejects.toThrow("Finish");
			if (action === "stop") call("stop", input.id);
			else sender.emit("did-start-loading");
			release(
				stream([
					{ type: "response.output_text.delta", delta: "Late output" },
					{ type: "response.completed" },
				]),
			);
			expect(await response).toEqual({ status: "stopped", text: "" });
			expect(sender.send).not.toHaveBeenCalled();
			mocks.create.mockClear();
		}
	});

	it("rejects oversized context before authentication or inference", async () => {
		const input = request();
		input.messages[0].text = "x".repeat(CHAT_CONTEXT_LIMIT);
		await expect(call("send", input)).rejects.toThrow("too long");
		expect(mocks.token).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});
});
