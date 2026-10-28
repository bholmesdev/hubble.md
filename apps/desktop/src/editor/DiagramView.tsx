import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	type Editor,
	loadSnapshot,
	parseTldrawJsonFile,
	type TLStore,
	type TLUiComponents,
	Tldraw,
} from "tldraw";
import "tldraw/tldraw.css";
import "./DiagramView.css";
import { savePathContent, updateEditorContent } from "../store/actions";
import { isDarkTheme, subscribeTheme } from "../theme";
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

const licenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY;

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

	const handleMount = (editor: Editor) => {
		const session = sessionRef.current;
		session.editor = editor;
		setActiveDiagram(editor);
		editor.user.updateUserPreferences({
			colorScheme: isDarkTheme() ? "dark" : "light",
		});
		// Only user edits to the document save; camera moves and selection don't.
		const stopListening = editor.store.listen(
			() => scheduleDiagramSave(session),
			{ source: "user", scope: "document" },
		);
		return () => {
			stopListening();
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

	return (
		<div className="relative min-h-0 flex-1" data-hubble-diagram>
			<Tldraw
				store={parsed.store}
				licenseKey={licenseKey}
				assetUrls={diagramAssetUrls}
				components={components}
				onMount={handleMount}
			/>
		</div>
	);
}
