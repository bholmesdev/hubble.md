import type {
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Drag = {
	id: string;
	from: number;
	to: number;
	offset: number;
	width: number;
};
type Session = Drag & {
	pointerId: number;
	startX: number;
	button: HTMLButtonElement;
	moved: boolean;
	order: string;
};

/** Preview with transforms so dragging never changes persisted tab order before release. */
export function useTabDrag(
	ids: string[],
	disabled: boolean,
	onActivate: (id: string) => void,
	onReorder?: (id: string, toIndex: number) => void,
) {
	const session = useRef<Session | null>(null);
	const suppressClick = useRef(false);
	const [drag, setDrag] = useState<Drag | null>(null);
	const order = ids.join("\0");

	const cancel = useCallback(() => {
		const current = session.current;
		session.current = null;
		setDrag(null);
		if (current?.moved) suppressClick.current = true;
		if (current?.button.hasPointerCapture(current.pointerId)) {
			current.button.releasePointerCapture(current.pointerId);
		}
	}, []);

	useEffect(() => {
		if (session.current && (disabled || session.current.order !== order))
			cancel();
	}, [cancel, order, disabled]);

	useEffect(() => {
		window.addEventListener("blur", cancel);
		return () => {
			window.removeEventListener("blur", cancel);
			cancel();
		};
	}, [cancel]);

	function start(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
		if (disabled || !onReorder || event.button !== 0 || !event.isPrimary)
			return;
		suppressClick.current = false;
		const from = ids.indexOf(id);
		const width =
			event.currentTarget.parentElement?.getBoundingClientRect().width;
		if (from < 0 || !width) return;
		session.current = {
			id,
			from,
			to: from,
			offset: 0,
			width,
			pointerId: event.pointerId,
			startX: event.clientX,
			button: event.currentTarget,
			moved: false,
			order,
		};
		// Keep tracking the pointer when an inactive tab passes beneath the selected tab.
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function move(event: ReactPointerEvent) {
		const current = session.current;
		if (!current || current.pointerId !== event.pointerId) return;
		const distance = event.clientX - current.startX;
		if (!current.moved && Math.abs(distance) < 4) return;
		current.moved = true;
		current.offset = Math.max(
			-current.from * current.width,
			Math.min((ids.length - current.from - 1) * current.width, distance),
		);
		current.to = Math.max(
			0,
			Math.min(
				ids.length - 1,
				current.from + Math.round(current.offset / current.width),
			),
		);
		setDrag({
			id: current.id,
			from: current.from,
			to: current.to,
			offset: current.offset,
			width: current.width,
		});
		event.preventDefault();
	}

	function finish(event: ReactPointerEvent) {
		const current = session.current;
		if (!current || current.pointerId !== event.pointerId) return;
		cancel();
		if (current.moved) {
			if (current.to !== current.from) onReorder?.(current.id, current.to);
			onActivate(current.id);
		}
	}

	function offset(index: number) {
		if (!drag) return 0;
		if (index === drag.from) return drag.offset;
		if (index > drag.from && index <= drag.to) return -drag.width;
		if (index < drag.from && index >= drag.to) return drag.width;
		return 0;
	}

	function click(event: ReactMouseEvent) {
		if (!suppressClick.current) return;
		suppressClick.current = false;
		event.preventDefault();
		event.stopPropagation();
	}

	return { drag, start, move, finish, cancel, offset, click };
}
