import { useEffect, useState } from "react";

// Tailwind's `sm`, so `max-sm:` styles flip at the same width.
const COMPACT_WINDOW_QUERY = "(width < 40rem)";

export function isCompactWindow() {
	return window.matchMedia(COMPACT_WINDOW_QUERY).matches;
}

export function useCompactWindow() {
	const [compact, setCompact] = useState(isCompactWindow);

	useEffect(() => {
		const query = window.matchMedia(COMPACT_WINDOW_QUERY);
		const update = () => setCompact(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	return compact;
}
