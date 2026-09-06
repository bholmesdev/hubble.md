/** Ignore sub-pixel leftover so the dashed edge does not flicker. */
const MEANINGFUL_OVERFLOW_PX = 8;
const AT_EDGE_PX = 2;

/**
 * Returns whether a footer should show a divider because scrollable content
 * continues beneath it. The small threshold avoids flicker from sub-pixel
 * scroll measurements and near-empty overflow.
 */
export function shouldShowFooterDivider(scrollContainer: HTMLElement | null) {
	if (!scrollContainer) return false;
	const maxScrollTop = Math.max(
		scrollContainer.scrollHeight - scrollContainer.clientHeight,
		0,
	);
	const hasMeaningfulOverflow = maxScrollTop > MEANINGFUL_OVERFLOW_PX;
	const isAtBottom = maxScrollTop - scrollContainer.scrollTop <= AT_EDGE_PX;
	return hasMeaningfulOverflow && !isAtBottom;
}

/**
 * Which ends of a horizontal scroller still have content past them. Same
 * thresholds as the editor's vertical dashed divider.
 */
export function horizontalOverflowEdges(scroller: HTMLElement | null): {
	start: boolean;
	end: boolean;
} {
	if (!scroller) return { start: false, end: false };
	const maxScrollLeft = Math.max(
		scroller.scrollWidth - scroller.clientWidth,
		0,
	);
	if (maxScrollLeft <= MEANINGFUL_OVERFLOW_PX) {
		return { start: false, end: false };
	}
	return {
		start: scroller.scrollLeft > AT_EDGE_PX,
		end: maxScrollLeft - scroller.scrollLeft > AT_EDGE_PX,
	};
}
