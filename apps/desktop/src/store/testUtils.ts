import { vi } from "vitest";

export type MockDesktopApi = {
	readFileText: ReturnType<typeof vi.fn>;
	writeFileText: ReturnType<typeof vi.fn>;
	listDirectory: ReturnType<typeof vi.fn>;
	readWorkspaceConfig: ReturnType<typeof vi.fn>;
	writeWorkspaceConfig: ReturnType<typeof vi.fn>;
	createFolder: ReturnType<typeof vi.fn>;
	renameFile: ReturnType<typeof vi.fn>;
	deleteFile: ReturnType<typeof vi.fn>;
	stageDelete: ReturnType<typeof vi.fn>;
	restoreDelete: ReturnType<typeof vi.fn>;
	finalizeDelete: ReturnType<typeof vi.fn>;
	setDeleteUndoAvailable: ReturnType<typeof vi.fn>;
	undoText: ReturnType<typeof vi.fn>;
	pathExists: ReturnType<typeof vi.fn>;
	openPathFromLink: ReturnType<typeof vi.fn>;
	openPathInDefaultApp: ReturnType<typeof vi.fn>;
	sidebarDeltaForPath: ReturnType<typeof vi.fn>;
	setThemeSource: ReturnType<typeof vi.fn>;
	getTelemetryConsent: ReturnType<typeof vi.fn>;
	setTelemetryConsent: ReturnType<typeof vi.fn>;
	recordTelemetryActivity: ReturnType<typeof vi.fn>;
	getSpellcheckState: ReturnType<typeof vi.fn>;
	setSpellcheckEnabled: ReturnType<typeof vi.fn>;
	setSpellcheckLanguages: ReturnType<typeof vi.fn>;
};

export function createDesktopApi(): MockDesktopApi {
	return {
		readFileText: vi.fn(async () => "before"),
		writeFileText: vi.fn(async () => {}),
		listDirectory: vi.fn(async () => ({ files: [], folders: [] })),
		readWorkspaceConfig: vi.fn(async () => ({ version: 1, pinnedNotes: [] })),
		writeWorkspaceConfig: vi.fn(async () => {}),
		createFolder: vi.fn(async () => {}),
		renameFile: vi.fn(async () => {}),
		deleteFile: vi.fn(async () => {}),
		stageDelete: vi.fn(async () => "delete-token"),
		restoreDelete: vi.fn(async () => {}),
		finalizeDelete: vi.fn(async () => {}),
		setDeleteUndoAvailable: vi.fn(async () => {}),
		undoText: vi.fn(async () => {}),
		pathExists: vi.fn(async () => false),
		openPathFromLink: vi.fn(async () => ({ kind: "opened" })),
		openPathInDefaultApp: vi.fn(async () => {}),
		sidebarDeltaForPath: vi.fn(async () => null),
		setThemeSource: vi.fn(async () => {}),
		getTelemetryConsent: vi.fn(async () => "unset"),
		setTelemetryConsent: vi.fn(async (choice) => choice),
		recordTelemetryActivity: vi.fn(async () => {}),
		getSpellcheckState: vi.fn(async () => ({
			enabled: true,
			languages: ["en-US"],
			availableLanguages: ["en-US", "fr"],
			systemLanguage: "en-US",
		})),
		setSpellcheckEnabled: vi.fn(async () => {}),
		setSpellcheckLanguages: vi.fn(async () => {}),
	};
}

/**
 * Actions capture window.desktopApi at import time, so each test stubs globals
 * before importing the store modules.
 */
export async function loadStoreActions(
	api: MockDesktopApi,
	persisted: string | null = null,
	systemPrefersDark: () => boolean = () => false,
) {
	vi.resetModules();
	vi.stubGlobal("localStorage", {
		getItem: vi.fn(() => persisted),
		setItem: vi.fn(),
	});
	vi.stubGlobal("window", {
		desktopApi: api,
		setTimeout,
		clearTimeout,
		matchMedia: () => ({
			get matches() {
				return systemPrefersDark();
			},
			addEventListener() {},
			removeEventListener() {},
		}),
	});

	const actions = await import("./actions");
	const history = await import("./history");
	const state = await import("./state");
	const tabStore = await import("./tabStore");
	return { ...actions, ...history, ...state, ...tabStore };
}
