// `?raw` icon imports are SVG strings. The longer prefix wins over the React
// types' `~icons/*`. Kept apart from vite-env.d.ts, whose import makes it a
// module where this wildcard wouldn't apply globally.
declare module "~icons/mingcute/*?raw" {
	const svg: string;
	export default svg;
}
