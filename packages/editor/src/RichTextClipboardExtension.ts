import { Extension } from "@tiptap/core";
import {
	type DOMOutputSpec,
	DOMSerializer,
	type Mark,
	type Schema,
} from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { getLinkAttrs } from "./Link.js";

export const RichTextClipboardExtension = Extension.create({
	name: "richTextClipboard",

	addProseMirrorPlugins() {
		const clipboardSerializer = createRichTextClipboardSerializer(
			this.editor.schema,
		);
		return [
			new Plugin({
				props: {
					clipboardSerializer,
				},
			}),
		];
	},
});

export function createRichTextClipboardSerializer(
	schema: Schema,
): DOMSerializer {
	const baseSerializer = DOMSerializer.fromSchema(schema);
	return new DOMSerializer(baseSerializer.nodes, {
		...baseSerializer.marks,
		link: serializeLinkForClipboard,
	});
}

function serializeLinkForClipboard(mark: Mark): DOMOutputSpec {
	const attrs = getLinkAttrs(mark.attrs);
	if (!attrs?.href) {
		return ["span", { "data-link": "true" }, 0];
	}

	const htmlAttrs: Record<string, string> = {
		href: attrs.href,
		"data-href": attrs.href,
		"data-link-kind": attrs.kind,
		"data-link": "true",
	};

	if (attrs.target) {
		htmlAttrs["data-target"] = attrs.target;
	}

	return ["a", htmlAttrs, 0];
}
