import {
	computePosition,
	flip,
	offset,
	shift,
	size,
	type VirtualElement,
} from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { type RefObject, useEffect } from "react";

type MenuPosition = {
	x: number;
	y: number;
};

function updateCommandMenuPosition({
	editor,
	viewport,
	floatingEl,
	pos,
	setPosition,
}: {
	editor: Editor;
	viewport: HTMLDivElement;
	floatingEl: HTMLDivElement;
	pos: number;
	setPosition: (position: MenuPosition) => void;
}) {
	const reference: VirtualElement = {
		contextElement: viewport,
		getBoundingClientRect() {
			const coords = editor.view.coordsAtPos(pos);
			return {
				x: coords.left,
				y: coords.top,
				left: coords.left,
				top: coords.top,
				right: coords.right,
				bottom: coords.bottom,
				width: coords.right - coords.left,
				height: coords.bottom - coords.top,
				toJSON() {
					return this;
				},
			};
		},
	};

	return computePosition(reference, floatingEl, {
		strategy: "absolute",
		placement: "bottom-start",
		middleware: [
			offset(6),
			flip({
				boundary: viewport,
				fallbackPlacements: ["top-start", "bottom-end", "top-end"],
				padding: 8,
			}),
			shift({
				boundary: viewport,
				padding: 8,
				crossAxis: true,
			}),
			size({
				boundary: viewport,
				padding: 8,
				apply({ availableHeight, elements }) {
					elements.floating.style.setProperty(
						"--command-menu-height",
						`${Math.max(0, availableHeight)}px`,
					);
				},
			}),
		],
	}).then(({ x, y }) => {
		setPosition({ x, y });
	});
}

export function useCommandMenuPosition({
	editor,
	floatingRef,
	pos,
	setPosition,
	viewportRef,
}: {
	editor: Editor | null;
	floatingRef: RefObject<HTMLDivElement | null>;
	pos: number | null;
	setPosition: (position: MenuPosition) => void;
	viewportRef: RefObject<HTMLDivElement | null>;
}) {
	useEffect(() => {
		if (!editor || pos === null) return;
		const viewport = viewportRef.current;
		const floatingEl = floatingRef.current;
		if (!viewport || !floatingEl) return;

		const update = () => {
			void updateCommandMenuPosition({
				editor,
				viewport,
				floatingEl,
				pos,
				setPosition,
			});
		};

		update();
		viewport.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		const observer = new ResizeObserver(update);
		observer.observe(viewport);
		observer.observe(floatingEl);

		return () => {
			viewport.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
			observer.disconnect();
		};
	}, [editor, floatingRef, pos, setPosition, viewportRef]);
}
