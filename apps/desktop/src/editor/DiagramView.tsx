import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	type Editor,
	loadSnapshot,
	parseTldrawJsonFile,
	react,
	type Signal,
	type TLStore,
	type TLUiComponents,
	type TLUiOverrides,
	Tldraw,
} from "tldraw";
import "tldraw/tldraw.css";
import "./DiagramView.css";
import { recallCamera, rememberCamera } from "../lib/scrollMemory";
import {
	savePathContent,
	setDiagramGrid,
	updateEditorContent,
} from "../store/actions";
import { diagramGridStore } from "../store/state";
import { isDarkTheme, subscribeTheme } from "../theme";
import { DiagramLicenseNotice } from "./DiagramLicenseNotice";
import { clearActiveDiagram, setActiveDiagram } from "./diagramCommands";
import { diagramAssetUrls } from "./diagramIcons";

const SAVE_DEBOUNCE_MS = 300;
// Matches tldraw's own `.tldr` writer (`serializeTldrawJson`).
const TLDRAW_FILE_FORMAT_VERSION = 1;

// The app's own menus replace tldraw's: Edit and View route to the canvas,
// and diagram options live in the file's ⋯ menu. A diagram file is one
// tldraw document, so multi-page navigation goes too.
const components: TLUiComponents = {
	MenuPanel: null,
	PageMenu: null,
	NavigationPanel: null,
};

// Zoom follows Sketch: Cmd-1 fits, Cmd-2 zooms to the selection, and Cmd-0
// is the View menu's reset. tldraw's Shift-number keys fire when "!" or "@"
// is typed with the canvas focused. Copy as PNG gives Cmd-Shift-C back to
// Copy File Path.
const overrides: TLUiOverrides = {
	actions(_editor, actions) {
		actions["zoom-to-fit"].kbd = "cmd+1,ctrl+1";
		actions["zoom-to-selection"].kbd = "cmd+2,ctrl+2";
		delete actions["zoom-to-100"].kbd;
		delete actions["copy-as-png"].kbd;
		return actions;
	},
};

const licenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY;

// tldraw validates the key per editor and keeps the result off its public
// types. Without it (a tldraw upgrade), Hubble falls back to tldraw's own
// blank editor.
type LicensedEditor = Editor & { licenseManager?: { state: Signal<string> } };

/** The states in which tldraw hides the editor after a few seconds. */
function isLicenseRejected(editor: Editor) {
	const state = (editor as LicensedEditor).licenseManager?.state.get();
	return state === "expired" || state === "unlicensed-production";
}

// One key serves every diagram, so once it fails, later diagrams skip
// straight to the notice.
let licenseRejected = false;

type ParsedDiagram = { store: TLStore } | { error: string };

function parseDiagram(content: string): ParsedDiagram {
	const store = createTLStore({
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
	});
	// New diagrams start as empty files; tldraw fills in the first page.
	if (content.trim().length === 0) return { store };
	const result = parseTldrawJsonFile({ json: content, schema: store.schema });
	if (!result.ok) {
		return { error: `Could not open diagram (${result.error.type}).` };
	}
	return { store: result.value };
}

/**
 * Synchronous so unmount can flush. tldraw's in-memory asset store already
 * inlines images as data URLs, so `serializeTldrawJson`'s async asset fetch
 * has nothing to do here.
 */
function serializeDiagram(store: TLStore) {
	return JSON.stringify({
		tldrawFileFormatVersion: TLDRAW_FILE_FORMAT_VERSION,
		schema: store.schema.serialize(),
		records: store.allRecords(),
	});
}

type DiagramSession = {
	path: string;
	editor: Editor | null;
	/** Last JSON written by this view or loaded from disk. */
	content: string;
	saveTimer: number | null;
};

function flushDiagramSave(session: DiagramSession) {
	if (session.saveTimer === null || !session.editor) return;
	window.clearTimeout(session.saveTimer);
	session.saveTimer = null;
	const next = serializeDiagram(session.editor.store);
	session.content = next;
	updateEditorContent(session.path, next);
	void savePathContent(session.path, next);
}

function scheduleDiagramSave(session: DiagramSession) {
	if (session.saveTimer !== null) window.clearTimeout(session.saveTimer);
	// flushDiagramSave reads the still-set id as "pending work".
	session.saveTimer = window.setTimeout(
		() => flushDiagramSave(session),
		SAVE_DEBOUNCE_MS,
	);
}

/** Keyed by path in the caller, so one view only ever edits one file. */
export function DiagramView({
	path,
	content,
}: {
	path: string;
	content: string;
}) {
	const [parsed] = useState(() => parseDiagram(content));
	const sessionRef = useRef<DiagramSession>({
		path,
		editor: null,
		content,
		saveTimer: null,
	});
	const isDark = useSyncExternalStore(subscribeTheme, isDarkTheme);
	const [rejected, setRejected] = useState(licenseRejected);

	const handleMount = (editor: Editor) => {
		const session = sessionRef.current;
		session.editor = editor;
		const stopLicenseWatch = react("diagram license", () => {
			if (!isLicenseRejected(editor)) return;
			licenseRejected = true;
			flushDiagramSave(session);
			setRejected(true);
		});
		setActiveDiagram(editor);
		editor.user.updateUserPreferences({
			colorScheme: isDarkTheme() ? "dark" : "light",
		});
		// Grid mode is an app-wide setting, so it follows the user between
		// diagrams. The ⋯ menu and tldraw's shortcut both toggle the editor,
		// and this keeps the setting in step.
		editor.updateInstanceState({ isGridMode: diagramGridStore.get() });
		// Reopening a diagram returns to where the user left it this session,
		// like a note's scroll position. A first open keeps the file's camera.
		// Recording every move, not just on close, keeps an entry in memory
		// for a rename to carry to the new path.
		const camera = recallCamera(session.path);
		if (camera) editor.setCamera(camera, { immediate: true });
		const stopCameraMemory = react("diagram camera memory", () =>
			rememberCamera(session.path, editor.getCamera()),
		);
		const stopGridSync = react("diagram grid setting", () =>
			setDiagramGrid(editor.getInstanceState().isGridMode),
		);
		// Only user edits to the document save; camera moves and selection don't.
		const stopListening = editor.store.listen(
			() => scheduleDiagramSave(session),
			{ source: "user", scope: "document" },
		);
		return () => {
			stopLicenseWatch();
			stopListening();
			stopGridSync();
			stopCameraMemory();
			clearActiveDiagram(editor);
		};
	};

	useEffect(() => {
		sessionRef.current.editor?.user.updateUserPreferences({
			colorScheme: isDark ? "dark" : "light",
		});
	}, [isDark]);

	// The file changed on disk (an agent or another app wrote it): load its
	// document in place so the camera and selection survive.
	useEffect(() => {
		const session = sessionRef.current;
		const editor = session.editor;
		if (!editor || content === session.content) return;
		session.content = content;
		const next = parseDiagram(content);
		if ("error" in next) return;
		editor.store.mergeRemoteChanges(() => {
			loadSnapshot(editor.store, {
				document: next.store.getStoreSnapshot("document"),
			});
		});
	}, [content]);

	useEffect(() => {
		const session = sessionRef.current;
		return () => flushDiagramSave(session);
	}, []);

	if ("error" in parsed) {
		return <p className="m-0 p-4 text-sm text-destructive">{parsed.error}</p>;
	}
	if (rejected) return <DiagramLicenseNotice path={path} />;

	return (
		<div className="relative min-h-0 flex-1" data-hubble-diagram>
			<Tldraw
				store={parsed.store}
				licenseKey={licenseKey}
				assetUrls={diagramAssetUrls}
				components={components}
				overrides={overrides}
				onMount={handleMount}
			/>
		</div>
	);
}
