// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { chatInput } from "../desktopApi/chat";
import type { VoiceEvent } from "../desktopApi/voice";
import { appStore } from "./state";
import { attachToChat } from "./tabChat";
import { tabsStore } from "./tabStore";
import { emptyTabs, withOpenedTab } from "./tabs";
import { startVoice, stopVoice, voice, voiceLevel } from "./voice";

const api = vi.hoisted(() => ({
	voiceStart: vi.fn(),
	voiceStop: vi.fn(),
	onVoice: vi.fn(),
}));
vi.mock("../desktopApi", () => ({ desktopApi: api }));
let emit: (event: VoiceEvent) => void;
beforeEach(() => {
	vi.clearAllMocks();
	api.onVoice.mockImplementation((callback) => {
		emit = callback;
		return vi.fn();
	});
	api.voiceStart.mockResolvedValue(undefined);
	api.voiceStop.mockResolvedValue(undefined);
	voice.set(null);
	appStore.set((s) => ({
		...s,
		workspace: { ...s.workspace, workspacePath: "/notes" },
	}));
	tabsStore.set(withOpenedTab(emptyTabs(), "/notes/a.md"));
});
it("keeps revisions in the original tab draft and ignores late output from old recordings", async () => {
	const tabId = activeTab();
	tabsStore.set((s) => ({
		...s,
		byId: {
			...s.byId,
			[tabId]: {
				...s.byId[tabId],
				chat: { messages: [], model: "", draft: "Existing draft." },
			},
		},
	}));
	await startVoice(tabId);
	const id = api.voiceStart.mock.calls[0][0];
	emit({ id, status: "listening", text: "hello" });
	expect(
		attachToChat({
			kind: "selection",
			path: "/notes/a.md",
			text: "Highlighted context",
		}),
	).toBe(true);
	emit({ id, status: "listening", text: "hello world" });
	expect(api.voiceStart).toHaveBeenCalledTimes(1);
	expect(tabsStore.get().byId[tabId].chat?.attachments).toHaveLength(1);
	expect(tabsStore.get().byId[tabId].chat?.draft).toBe(
		"Existing draft.\nhello world",
	);
	tabsStore.set(withOpenedTab(tabsStore.get(), "/notes/b.md", "new"));
	stopVoice();
	emit({ id, status: "stopped", text: "Hello world." });
	expect(tabsStore.get().byId[tabId].chat?.draft).toBe(
		"Existing draft.\nHello world.",
	);
	expect(tabsStore.get().byId[activeTab()].chat?.draft).toBeUndefined();
	await startVoice(activeTab());
	emit({ id, status: "stopped", text: "stale" });
	expect(voice.get()?.id).not.toBe(id);
});
it("preserves partial speech on failure and offers another recording", async () => {
	const tabId = activeTab();
	await startVoice(tabId);
	const id = api.voiceStart.mock.calls[0][0];
	emit({ id, status: "listening", text: "keep this" });
	emit({
		id,
		status: "error",
		error: "Microphone access denied. Enable it in System Settings.",
	});
	expect(tabsStore.get().byId[tabId].chat?.draft).toBe("keep this");
	expect(voice.get()).toMatchObject({
		status: "error",
		error: expect.stringContaining("System Settings"),
	});
	await startVoice(tabId);
	expect(api.voiceStart).toHaveBeenCalledTimes(2);
});

function activeTab() {
	const id = tabsStore.get().activeTabId;
	if (!id) throw new Error("Missing tab");
	return id;
}

it("updates microphone levels without clearing speech or changing chat state", async () => {
	await startVoice(activeTab());
	const id = api.voiceStart.mock.calls[0][0];
	emit({ id, status: "listening", text: "Keep my words" });
	const recording = voice.get();
	const tabs = tabsStore.get();
	emit({ id, status: "listening", level: 0.7 });
	expect(voiceLevel.get()).toBe(0.7);
	expect(voice.get()).toBe(recording);
	expect(tabsStore.get()).toBe(tabs);
	emit({ id: "old-session", status: "listening", level: 1 });
	expect(voiceLevel.get()).toBe(0.7);
	stopVoice();
	const stopping = voice.get();
	expect(voiceLevel.get()).toBe(0);
	emit({ id, status: "listening", level: 1 });
	expect(voiceLevel.get()).toBe(0);
	expect(voice.get()).toBe(stopping);
	emit({ id, status: "stopped", text: "Keep my words." });
	await startVoice(activeTab());
	expect(voiceLevel.get()).toBe(0);
});

it("keeps voice highlights between spoken phrases through speech corrections", async () => {
	const tabId = activeTab();
	await startVoice(tabId);
	const id = api.voiceStart.mock.calls[0][0];
	emit({ id, status: "listening", text: "read this" });
	attachToChat(
		{ kind: "selection", path: "/notes/a.md", text: "First quote" },
		true,
	);
	emit({ id, status: "listening", text: "Read this. Then compare" });
	attachToChat(
		{ kind: "selection", path: "/notes/a.md", text: "Second quote" },
		true,
	);
	emit({
		id,
		status: "stopped",
		text: "Read this. Then compare both sections.",
	});
	const chat = tabsStore.get().byId[tabId].chat;
	if (!chat) throw new Error("Missing chat");
	expect(chat.attachments?.map((a) => a.offset)).toEqual([10, 23]);
	const input = chatInput([
		{
			id: "turn",
			role: "user",
			status: "complete",
			text: chat.draft,
			attachments: chat.attachments,
		},
	])[0].content;
	expect(input.indexOf("Read this.")).toBeLessThan(
		input.indexOf("First quote"),
	);
	expect(input.indexOf("First quote")).toBeLessThan(
		input.indexOf("Then compare"),
	);
	expect(input.indexOf("Then compare")).toBeLessThan(
		input.indexOf("Second quote"),
	);
	expect(input.indexOf("Second quote")).toBeLessThan(
		input.indexOf("both sections."),
	);
	expect(input.match(/First quote/g)).toHaveLength(1);
});
