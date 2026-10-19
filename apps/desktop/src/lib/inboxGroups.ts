const DAY_MS = 24 * 60 * 60 * 1000;

export type InboxGroup<T> = { label: string; items: T[] };

function startOfDay(time: number) {
	const date = new Date(time);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

/** Buckets a time the way Apple Notes does: recent days, then months, then years. */
export function inboxGroupLabel(time: number, now = Date.now()): string {
	const daysAgo = Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
	if (daysAgo <= 0) return "Today";
	if (daysAgo === 1) return "Yesterday";
	if (daysAgo < 7) return "Previous 7 Days";
	if (daysAgo < 30) return "Previous 30 Days";
	const date = new Date(time);
	if (date.getFullYear() === new Date(now).getFullYear()) {
		return date.toLocaleDateString(undefined, { month: "long" });
	}
	return String(date.getFullYear());
}

/** Groups items already sorted newest first, keeping that order. */
export function groupInboxItems<T>(
	items: T[],
	timeOf: (item: T) => number,
	now = Date.now(),
): InboxGroup<T>[] {
	const groups: InboxGroup<T>[] = [];
	for (const item of items) {
		const label = inboxGroupLabel(timeOf(item), now);
		const last = groups[groups.length - 1];
		if (last?.label === label) last.items.push(item);
		else groups.push({ label, items: [item] });
	}
	return groups;
}

/** Shows a time for today's notes and a short date otherwise. */
export function inboxDateLabel(time: number, now = Date.now()): string {
	return startOfDay(time) === startOfDay(now)
		? new Date(time).toLocaleTimeString(undefined, {
				hour: "numeric",
				minute: "2-digit",
			})
		: new Date(time).toLocaleDateString(undefined, {
				year: "2-digit",
				month: "numeric",
				day: "numeric",
			});
}
