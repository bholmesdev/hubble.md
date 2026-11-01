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
