import { Menu } from "@base-ui/react/menu";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { copyAs, type Editor, react, type TLCopyType } from "tldraw";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteFileCodeLine from "~icons/mingcute/file-code-line";
import MingcuteGridLine from "~icons/mingcute/grid-line";
import MingcuteMagnetLine from "~icons/mingcute/magnet-line";
import MingcutePicLine from "~icons/mingcute/pic-line";
import { getActiveDiagram } from "../editor/diagramCommands";

/** Copies the selection as an image, or the whole diagram with none. */
async function copyImage(editor: Editor, format: Exclude<TLCopyType, "json">) {
	const selected = editor.getSelectedShapeIds();
	const ids =
		selected.length > 0 ? selected : [...editor.getCurrentPageShapeIds()];
	const label = format.toUpperCase();
	try {
		await copyAs(editor, ids, { format });
		toast.success(`${label} copied`);
	} catch {
		toast.error(`Failed to copy ${label}`);
	}
}

/** Diagram options for the file's ⋯ menu, replacing tldraw's preferences. */
export function DiagramMenuItems({ itemClass }: { itemClass: string }) {
	const editor = getActiveDiagram();
	if (!editor) return null;
	return <DiagramToggles editor={editor} itemClass={itemClass} />;
}

function DiagramToggles({
	editor,
	itemClass,
}: {
	editor: Editor;
	itemClass: string;
}) {
	// tldraw state is signals; `react` reruns when either value changes.
	const subscribe = (onChange: () => void) =>
		react("diagram menu items", () => {
			editor.getInstanceState().isGridMode;
			editor.user.getIsSnapMode();
			editor.getCurrentPageShapeIds().size;
			onChange();
		});
	const isGridMode = useSyncExternalStore(
		subscribe,
		() => editor.getInstanceState().isGridMode,
	);
	const isSnapMode = useSyncExternalStore(subscribe, () =>
		editor.user.getIsSnapMode(),
	);
	const isEmpty = useSyncExternalStore(
		subscribe,
		() => editor.getCurrentPageShapeIds().size === 0,
	);

	return (
		<>
			<Menu.Item
				className={itemClass}
				onClick={() => editor.updateInstanceState({ isGridMode: !isGridMode })}
			>
				<MingcuteGridLine className="size-3 shrink-0" />
				<span className="min-w-0 flex-1">Show grid</span>
				{isGridMode && <MingcuteCheckLine className="size-3 shrink-0" />}
			</Menu.Item>
			<Menu.Item
				className={itemClass}
				onClick={() =>
					editor.user.updateUserPreferences({ isSnapMode: !isSnapMode })
				}
			>
				<MingcuteMagnetLine className="size-3 shrink-0" />
				<span className="min-w-0 flex-1">Always snap</span>
				{isSnapMode && <MingcuteCheckLine className="size-3 shrink-0" />}
			</Menu.Item>
			<Menu.Item
				className={itemClass}
				disabled={isEmpty}
				onClick={() => void copyImage(editor, "png")}
			>
				<MingcutePicLine className="size-3 shrink-0" />
				<span className="min-w-0 flex-1">Copy as PNG</span>
			</Menu.Item>
			<Menu.Item
				className={itemClass}
				disabled={isEmpty}
				onClick={() => void copyImage(editor, "svg")}
			>
				<MingcuteFileCodeLine className="size-3 shrink-0" />
				<span className="min-w-0 flex-1">Copy as SVG</span>
			</Menu.Item>
		</>
	);
}
