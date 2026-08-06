import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageNodeView } from "./ImageNodeView";
export function createImageExtension(filePath: string) {
	return Image.extend({
		group: "block tableCellContent",
		addAttributes() {
			return {
				...this.parent?.(),
				uploadId: {
					default: null,
					renderHTML: () => ({}),
				},
				uploadStatus: {
					default: null,
					renderHTML: () => ({}),
				},
				uploadFile: {
					default: null,
					renderHTML: () => ({}),
				},
				width: {
					default: null,
					renderHTML: () => ({}),
				},
				height: {
					default: null,
					renderHTML: () => ({}),
				},
			};
		},
		addNodeView() {
			return ReactNodeViewRenderer((props) => (
				<ImageNodeView {...props} filePath={filePath} />
			));
		},
	}).configure({
		inline: false,
		allowBase64: true,
	});
}
