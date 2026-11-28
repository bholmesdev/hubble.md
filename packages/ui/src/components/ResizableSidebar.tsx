import {
	type ComponentPropsWithoutRef,
	type RefObject,
	useRef,
	useState,
} from "react";
import { useResizeSeparator } from "../hooks/useResizeSeparator";
import { cn } from "../lib/utils";

const COLLAPSE_EDGE_DISTANCE = 24;
const HANDLE_WIDTH = 10;

export function ResizableSidebar({
	side,
	width,
	minWidth,
	maxWidth,
	onWidthChange,
	onCollapse,
	onCommit,
	resizeLabel,
	panelRef,
	children,
	className,
	style,
	...props
}: ComponentPropsWithoutRef<"aside"> & {
	side: "left" | "right";
	width: number;
	minWidth: number;
	maxWidth: number;
	onWidthChange: (width: number) => void;
	onCollapse?: () => void;
	onCommit?: () => void;
	resizeLabel: string;
	panelRef?: RefObject<HTMLElement | null>;
}) {
	const ownRef = useRef<HTMLElement>(null);
	const targetRef = panelRef ?? ownRef;
	// Pointer release can precede the render that paints the collapse preview.
	const collapsedRef = useRef(false);
	const [collapsed, setCollapsed] = useState(false);
	function preview(next: boolean) {
		collapsedRef.current = next;
		setCollapsed(next);
	}
	const { isResizing, separatorProps } = useResizeSeparator({
		axis: "col",
		label: resizeLabel,
		value: width,
		min: minWidth,
		max: maxWidth,
		onChange: onWidthChange,
		targetRef,
		onResizeStart: () => preview(false),
		onResizeEnd: () => preview(false),
		onCommit: () => {
			if (collapsedRef.current && onCollapse) onCollapse();
			else onCommit?.();
			preview(false);
		},
		getPointerValue: ({ event, startRect }) => {
			const distance =
				side === "left" ? event.clientX : window.innerWidth - event.clientX;
			if (onCollapse && distance <= COLLAPSE_EDGE_DISTANCE) {
				preview(true);
				return null;
			}
			preview(false);
			return side === "left"
				? event.clientX - (startRect?.left ?? 0)
				: (startRect?.right ?? window.innerWidth) - event.clientX;
		},
	});
	return (
		<aside
			{...props}
			ref={targetRef}
			className={cn(
				"relative flex shrink-0 flex-col overflow-visible border-sidebar-border",
				side === "left" ? "border-e" : "border-s",
				isResizing && "select-none",
				className,
			)}
			style={{
				...style,
				inlineSize: collapsed ? 0 : width,
				minInlineSize: collapsed ? 0 : minWidth,
				maxInlineSize: maxWidth,
			}}
		>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{children}
			</div>
			<div
				className="group absolute z-20 cursor-col-resize touch-none outline-none [inset-block:0] [-webkit-app-region:no-drag]"
				style={{
					inlineSize: HANDLE_WIDTH,
					...(side === "left"
						? { insetInlineEnd: -HANDLE_WIDTH / 2 }
						: { insetInlineStart: -HANDLE_WIDTH / 2 }),
				}}
				{...separatorProps}
			>
				<span
					className={cn(
						"absolute bg-transparent [inset-block:0] [inset-inline-start:50%] [inline-size:1px] group-focus:bg-primary",
						isResizing && "bg-primary",
					)}
				/>
			</div>
		</aside>
	);
}
