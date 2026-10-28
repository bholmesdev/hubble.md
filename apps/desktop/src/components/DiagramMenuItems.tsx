import { Menu } from "@base-ui/react/menu";
import { useSyncExternalStore } from "react";
import { type Editor, react } from "tldraw";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteGridLine from "~icons/mingcute/grid-line";
import MingcuteMagnetLine from "~icons/mingcute/magnet-line";
import { getActiveDiagram } from "../editor/diagramCommands";

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
			onChange();
		});
	const isGridMode = useSyncExternalStore(
		subscribe,
		() => editor.getInstanceState().isGridMode,
	);
	const isSnapMode = useSyncExternalStore(subscribe, () =>
		editor.user.getIsSnapMode(),
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
		</>
	);
}
