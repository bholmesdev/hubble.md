/**
 * When tabs get too crowded, we hide them and encourage the user to click
 * the "All Tabs" toggle. Animate tabs into and out of that button to make
 * it clear where they go and how to find them.
 */
export function animateTabs(
	strip: HTMLElement,
	target: HTMLElement,
	collapsed: boolean,
): () => void {
	const tabs = [
		...strip.querySelectorAll<HTMLElement>(":scope > [data-tab-item]"),
	].reverse();
	if (
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
		!target.animate ||
		!tabs.length ||
		tabs.some((tab) => !tab.animate)
	) {
		return () => {};
	}

	const targetBounds = target.getBoundingClientRect();
	const targetX = targetBounds.left + targetBounds.width / 2;
	const targetY = targetBounds.top + targetBounds.height / 2;
	const bounds = tabs.map((tab) => tab.getBoundingClientRect());
	const stagger = Math.min(
		collapsed ? 80 : 50,
		(collapsed ? 600 : 400) / Math.max(1, tabs.length - 1),
	);
	const animations: Animation[] = [];
	const label = target.querySelector<HTMLElement>("[data-tab-menu-label]");
	const tabDuration = 500;
	const labelWipeDuration = 240;
	const labelEasing = "cubic-bezier(.22,1,.36,1)";
	const holdUntil = tabDuration + stagger * (tabs.length - 1) + 400;
	const labelDuration = holdUntil + labelWipeDuration;
	if (collapsed && label?.animate) {
		const backgroundFrames = [
			{ backgroundColor: "var(--muted)", offset: 0 },
			{
				backgroundColor: "var(--muted)",
				offset: holdUntil / labelDuration,
				easing: labelEasing,
			},
			{ backgroundColor: getComputedStyle(target).backgroundColor, offset: 1 },
		];
		animations.push(
			...[target, label].map((element) =>
				element.animate(backgroundFrames, { duration: labelDuration }),
			),
			label.animate(
				[
					{
						clipPath: "inset(0 0 0 100%)",
						offset: 0,
						easing: labelEasing,
					},
					{
						clipPath: "inset(0 0 0 0)",
						offset: labelWipeDuration / labelDuration,
					},
					{
						clipPath: "inset(0 0 0 0)",
						offset: holdUntil / labelDuration,
						easing: labelEasing,
					},
					{ clipPath: "inset(0 0 0 100%)", offset: 1 },
				],
				{ duration: labelDuration },
			),
		);
	}

	for (const [index, tab] of tabs.entries()) {
		const rect = bounds[index];
		const x = targetX - (rect.left + rect.width / 2);
		const y = targetY - (rect.top + rect.height / 2);
		const delay = (collapsed ? index : tabs.length - index - 1) * stagger;
		const frames = [
			{
				offset: 0,
				visibility: "visible",
				transform: "translate(0, 0) scale(1)",
			},
			{
				offset: 0.8,
				visibility: "visible",
				transform: `translate(${x * 0.9}px, ${y * 0.9}px) scale(0.85)`,
			},
			{
				offset: 1,
				visibility: "visible",
				transform: `translate(${x}px, ${y}px) scale(0)`,
			},
		];
		animations.push(
			tab.animate(
				// Reverse the path while preserving the fast-to-slow easing.
				collapsed
					? frames
					: [...frames]
							.reverse()
							.map((frame) => ({ ...frame, offset: 1 - frame.offset })),
				{
					duration: tabDuration,
					delay,
					easing: "cubic-bezier(.16,1,.3,1)",
					fill: "backwards",
				},
			),
		);
	}

	return () => {
		for (const animation of animations) animation.cancel();
	};
}
