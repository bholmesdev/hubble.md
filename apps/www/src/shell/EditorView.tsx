import { wikiDisplayNameForTarget } from "@hubble.md/editor";
import { EditorView as SharedEditorView, type WikiTarget } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import {
	loadPath,
	savePathContent,
	updateEditorContent,
} from "../store/actions";
import { filesStore, setReviewThreads } from "../store/state";
import { handleImageDrop, handleImagePaste } from "./handleImageUpload";
import { createWebImageExtension } from "./WebImageExtension";

type Props = {
	path: string;
	initialMarkdown: string;
};

export function EditorView({ path, initialMarkdown }: Props) {
	const files = useStoreValue(filesStore);
	const wikiTargets: WikiTarget[] = files.map((file) => ({
		path: file.path,
		target: file.path,
		title: wikiDisplayNameForTarget(file.path),
	}));

	return (
		<SharedEditorView
			path={path}
			initialMarkdown={initialMarkdown}
			wikiTargets={wikiTargets}
			extensions={[createWebImageExtension()]}
			onPaste={(editor, event) => handleImagePaste({ editor, event })}
			onDrop={(editor, event) => handleImageDrop({ editor, event })}
			onLocalChange={updateEditorContent}
			onSave={savePathContent}
			onOpenExternalLink={(href) => {
				window.open(href, "_blank", "noopener");
			}}
			onOpenWikiLink={(target) => void loadPath(target.split("#")[0] ?? target)}
			onReviewThreadsChange={setReviewThreads}
		/>
	);
}
