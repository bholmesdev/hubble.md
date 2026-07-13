import type { LinkKind } from "@hubble.md/editor";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

type LinkPayload = {
	href: string;
	kind: LinkKind;
	target: string | null;
};

function findLinkAtEvent(
	view: EditorView,
	event: MouseEvent,
): LinkPayload | null {
	const state = view.state;
	const posData = view.posAtCoords({ left: event.clientX, top: event.clientY });
	if (!posData) return null;
	const $pos = state.doc.resolve(posData.pos);
	for (const mark of $pos.marks()) {
		if (mark.type.name === "link" && typeof mark.attrs.href === "string") {
			return {
				href: mark.attrs.href,
				kind: mark.attrs.kind === "wiki" ? "wiki" : "url",
				target:
					typeof mark.attrs.target === "string" ? mark.attrs.target : null,
			};
		}
	}
	return null;
}

const MOD_CLASS = "mod-held";

function setModHeld(el: HTMLElement, held: boolean) {
	el.classList.toggle(MOD_CLASS, held);
}

export const LinkClickExtension = Extension.create<{
	onOpenExternalLink?: (href: string) => void | Promise<void>;
	onOpenWikiLink?: (target: string) => void | Promise<void>;
	requireModifier?: boolean;
}>({
	name: "linkClick",
	addOptions() {
		return { requireModifier: true };
	},
	addProseMirrorPlugins() {
		const root = this.editor.view.dom;

		const onKey = (e: KeyboardEvent) =>
			setModHeld(root, e.metaKey || e.ctrlKey);
		const onBlur = () => setModHeld(root, false);

		window.addEventListener("keydown", onKey);
		window.addEventListener("keyup", onKey);
		window.addEventListener("blur", onBlur);

		const openLink = (link: LinkPayload) => {
			if (link.kind === "wiki") {
				void this.options.onOpenWikiLink?.(link.target ?? link.href);
				return;
			}
			void this.options.onOpenExternalLink?.(link.href);
		};

		return [
			new Plugin({
				props: {
					handleDOMEvents: {
						mousedown: (view, event) => {
							if (this.options.requireModifier === false) return false;
							if (!event.metaKey && !event.ctrlKey) return false;
							const link = findLinkAtEvent(view, event);
							if (!link) return false;
							event.preventDefault();
							openLink(link);
							return true;
						},
						// Without a required modifier, open on click instead of
						// mousedown so a drag-selection starting on a link still
						// selects text rather than opening it.
						click: (view, event) => {
							if (this.options.requireModifier !== false) return false;
							if (event.button !== 0) return false;
							if (!view.state.selection.empty) return false;
							const link = findLinkAtEvent(view, event);
							if (!link) return false;
							event.preventDefault();
							openLink(link);
							return true;
						},
					},
				},
				destroy() {
					window.removeEventListener("keydown", onKey);
					window.removeEventListener("keyup", onKey);
					window.removeEventListener("blur", onBlur);
					setModHeld(root, false);
				},
			}),
		];
	},
});
