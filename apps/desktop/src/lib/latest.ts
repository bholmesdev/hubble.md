/**
 * Wraps an async function so only the latest invocation can apply its
 * result.  Earlier in-flight calls become "stale" and silently no-op.
 *
 * ```ts
 * const { run: load } = latest(async ({ isStale }, path: string) => {
 *   const content = await readFile(path);
 *   if (isStale()) return;
 *   applyContent(content);
 * });
 * load("/a.md"); // starts, then…
 * load("/b.md"); // …makes the first call stale
 * ```
 */
export function latest<Args extends unknown[]>(
	fn: (signal: { isStale: () => boolean }, ...args: Args) => Promise<void>,
) {
	let token = 0;

	const run = async (...args: Args) => {
		const myToken = ++token;
		await fn({ isStale: () => myToken !== token }, ...args);
	};
	return {
		run,
		invalidate: () => {
			token += 1;
		},
	};
}
