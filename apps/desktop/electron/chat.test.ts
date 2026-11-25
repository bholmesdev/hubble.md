import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CHAT_CONTEXT_LIMIT,
	type ChatRequest,
	type ChatResult,
} from "../src/desktopApi/chat";
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
	it("sends explicit message history with storage off, then streams only to its owner", async () => {
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
				content: "Explain this",
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
			expect(
				sender.send.mock.calls.every(
					([, payload]) => payload.debug?.direction === "request",
				),
			).toBe(true);
			mocks.create.mockClear();
		}
	});

	it("rejects oversized context before authentication or inference", async () => {
		const input = request();
		input.messages[0].text = "x".repeat(CHAT_CONTEXT_LIMIT);
		input.messages.push({
			id: "u2",
			role: "user",
			text: "One more character",
			status: "complete",
		});
		await expect(call("send", input)).rejects.toThrow("too long");
		expect(mocks.token).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});
});

it("sends attached file text through IPC without changing earlier request prefixes", async () => {
	mocks.create.mockImplementation(() =>
		Promise.resolve(stream([{ type: "response.completed" }])),
	);
	const input = request();
	Object.assign(input.messages[0], {
		file: {
			path: "notes/a.md",
			version: "snapshot-a",
			text: "Original note contents",
		},
	});
	await call("send", input);
	const first = mocks.create.mock.calls[0][0].input;
	expect(first[0].content).toContain("Original note contents");
	input.messages.push({
		id: "a1",
		role: "assistant",
		text: "Read it",
		status: "complete",
	});
	input.messages.push({
		id: "u2",
		role: "user",
		text: "Continue",
		status: "complete",
		...{ file: { path: "notes/a.md", version: "snapshot-a" } },
	});
	await call("send", input);
	const second = mocks.create.mock.calls[1][0].input;
	expect(second.slice(0, 1)).toEqual(first);
	expect(second.at(-1).content).toContain("snapshot-a");
	expect(JSON.stringify(second).match(/Original note contents/g)).toHaveLength(
		1,
	);
});

it("rejects file context that exceeds the request budget before calling OpenAI", async () => {
	const input = request();
	Object.assign(input.messages[0], {
		file: {
			path: "notes/a.md",
			version: "snapshot-a",
			text: "x".repeat(CHAT_CONTEXT_LIMIT),
		},
	});
	await expect(call("send", input)).rejects.toThrow("Chat is too long");
	expect(mocks.create).not.toHaveBeenCalled();
});

it("runs namespaced workspace tools and retains calls and results for follow-ups", async () => {
	const fs = await import("node:fs/promises");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-tool-loop-"));
	try {
		await fs.writeFile(path.join(root, "note.md"), "Original note\n");
		setupChatIpc(
			() => sender as unknown as WebContents,
			() => root,
		);
		sender.send.mockImplementation((channel, payload) => {
			if (channel === "desktop:chat-file-request")
				queueMicrotask(() =>
					call("file-reply", {
						requestId: payload.requestId,
						callId: payload.callId,
						open: false,
					}),
				);
		});
		const toolCall = (name: string, args: object, call_id: string) => ({
			type: "function_call",
			namespace: "workspace",
			name,
			arguments: JSON.stringify(args),
			call_id,
			id: `fc_${call_id}`,
		});
		mocks.create.mockImplementation(async (body) => {
			const result = body.input
				.filter((item) => item.type === "function_call_output")
				.slice(-1)[0];
			if (!result)
				return stream([
					{ type: "response.output_text.delta", delta: "Reading note." },
					{
						type: "response.completed",
						response: {
							output: [
								{
									type: "message",
									role: "assistant",
									id: "msg_read",
									status: "completed",
									content: [
										{
											type: "output_text",
											text: "Reading note.",
											annotations: [],
										},
									],
								},
								toolCall("read_file", { path: "note.md" }, "read"),
							],
						},
					},
				]);
			if (result.call_id === "read") {
				const version = JSON.parse(result.output).version;
				return stream([
					{
						type: "response.completed",
						response: {
							output: [
								toolCall(
									"apply_patch",
									{
										expected_version: version,
										patch:
											"*** Begin Patch\n*** Update File: note.md\n@@\n-Original note\n+Edited note\n*** End Patch",
									},
									"edit",
								),
							],
						},
					},
				]);
			}
			return stream([
				{ type: "response.output_text.delta", delta: "Edited it." },
				{
					type: "response.completed",
					response: {
						output: [
							{
								type: "message",
								role: "assistant",
								content: [
									{ type: "output_text", text: "Edited it.", annotations: [] },
								],
								id: "msg_final",
								status: "completed",
							},
						],
					},
				},
			]);
		});
		const input = request();
		const result = (await call("send", input)) as ChatResult;
		expect(result.status).toBe("complete");
		expect(result.text).toBe("Reading note.\n\nEdited it.");
		expect(await fs.readFile(path.join(root, "note.md"), "utf8")).toBe(
			"Edited note\n",
		);
		expect(mocks.create).toHaveBeenCalledTimes(3);
		const debug = sender.send.mock.calls
			.filter(
				([channel, event]) => channel === "desktop:chat-delta" && event.debug,
			)
			.map(([, event]) => event.debug);
		expect(
			debug.map(({ round, direction }) => `${round}:${direction}`),
		).toEqual([
			"1:request",
			"1:response",
			"2:request",
			"2:response",
			"3:request",
			"3:response",
		]);
		expect(
			debug
				.filter((item) => item.direction === "request")
				.map((item) => item.body),
		).toEqual(mocks.create.mock.calls.map(([body]) => body));

		expect(mocks.create.mock.calls[0][0].tools[0]).toMatchObject({
			type: "namespace",
			name: "workspace",
		});
		expect(
			mocks.create.mock.calls[0][0].tools[0].tools.map((t) => t.name),
		).toEqual(["list_files", "search_content", "read_file", "apply_patch"]);
		const lastInput = mocks.create.mock.calls[2][0].input;
		const completed = { ...input.messages[0] };
		const followup = request();
		followup.messages = [
			completed,
			{
				id: "reply",
				role: "assistant",
				text: result.text,
				status: "complete",
				context: result.context,
			},
			...followup.messages,
		];
		await call("send", followup);
		expect(
			mocks.create.mock.calls[3][0].input.slice(0, lastInput.length),
		).toEqual(lastInput);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

it("stops tool continuation when the workspace changes", async () => {
	const fs = await import("node:fs/promises");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "hubble-tool-scope-"));
	let workspace = root;
	try {
		await fs.writeFile(path.join(root, "note.md"), "Keep this");
		setupChatIpc(
			() => sender as unknown as WebContents,
			() => workspace,
		);
		sender.send.mockImplementation((channel, payload) => {
			if (channel === "desktop:chat-file-request")
				queueMicrotask(() =>
					call("file-reply", {
						requestId: payload.requestId,
						callId: payload.callId,
						open: false,
					}),
				);
			if (
				channel === "desktop:chat-delta" &&
				payload.context?.some((item) => item.type === "function_call_output")
			)
				workspace = "/another-workspace";
		});
		mocks.create.mockResolvedValue(
			stream([
				{
					type: "response.completed",
					response: {
						output: [
							{
								type: "function_call",
								namespace: "workspace",
								name: "read_file",
								arguments: '{"path":"note.md"}',
								call_id: "read",
								id: "fc_read",
							},
						],
					},
				},
			]),
		);
		expect(await call("send", request())).toMatchObject({ status: "stopped" });
		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect(await fs.readFile(path.join(root, "note.md"), "utf8")).toBe(
			"Keep this",
		);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

it("publishes the exact Responses bodies with quoted, spoken, and comment context", async () => {
	const response = {
		id: "resp_debug",
		status: "completed",
		output: [],
		usage: { input_tokens: 30, output_tokens: 4 },
	};
	mocks.create.mockResolvedValue(
		stream([{ type: "response.completed", response }]),
	);
	const input = request();
	input.messages[0] = {
		...input.messages[0],
		text: "Read this. Then compare.",
		file: { path: "note.md", version: "v1", text: "# Note" },
		attachments: [
			{
				id: "quote",
				kind: "selection",
				path: "/notes/note.md",
				text: "Selected quote",
				offset: 10,
				source: { from: 1, to: 15, text: "Selected quote" },
			},
			{
				id: "comment",
				kind: "thread",
				path: "/notes/note.md",
				text: "Comment anchor",
				comments: [{ author: "human", body: "Comment body" }],
			},
		],
	};
	await call("send", input);
	const payloads = sender.send.mock.calls
		.filter(
			([channel, event]) => channel === "desktop:chat-delta" && event.debug,
		)
		.map(([, event]) => event.debug);
	expect(payloads).toEqual([
		{ round: 1, direction: "request", body: mocks.create.mock.calls[0][0] },
		{ round: 1, direction: "response", body: response },
	]);
	expect(await call("payloads", input.id)).toEqual(payloads);
	const content = payloads[0].body.input[0].content;
	expect(content.indexOf("Read this.")).toBeLessThan(
		content.indexOf("Selected quote"),
	);
	expect(content.indexOf("Selected quote")).toBeLessThan(
		content.indexOf("Then compare."),
	);
	expect(content).toContain("Comment body");
	expect(content).not.toContain('"source"');
	expect(JSON.stringify(payloads)).not.toContain("test-oauth-token");
});
