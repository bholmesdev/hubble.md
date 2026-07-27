/**
 * Wrappers that coordinate overlapping calls to an async function. Each
 * answers the same question differently: what happens when a call arrives
 * while another is still running?
 *
 * - `takeLatest`: everything runs; only the newest call may apply its result.
 * - `dedupeRuns`: one run at a time; overlapping calls share one follow-up.
 * - `sequential`: every call runs, one at a time, in call order.
 */

/**
 * Wraps an async function so only the latest invocation can apply its
 * result. Earlier in-flight calls become "stale" and silently no-op.
 *
 * ```ts
 * const { run: load } = takeLatest(async ({ isStale }, path: string) => {
 *   const content = await readFile(path);
 *   if (isStale()) return;
 *   applyContent(content);
 * });
 * load("/a.md"); // starts, then…
 * load("/b.md"); // …makes the first call stale
 * ```
 */
export function takeLatest<Args extends unknown[]>(
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

/**
 * Wraps an async function so only one run is in flight at a time. Calls made
 * during a run share a single follow-up run after it settles, so every
 * caller's promise resolves once work has observed state at least as new as
 * when it called.
 *
 * ```ts
 * const flush = dedupeRuns(() => sendPending());
 * void flush(); // starts a run
 * void flush(); // queues one follow-up run
 * void flush(); // shares that same follow-up run
 * ```
 */
export function dedupeRuns(run: () => Promise<void>): () => Promise<void> {
	let current: Promise<void> | null = null;
	let next: Promise<void> | null = null;

	const invoke = (): Promise<void> => {
		if (!current) {
			current = run().finally(() => {
				current = null;
			});
			return current;
		}
		next ??= current
			.catch(() => {})
			.then(() => {
				next = null;
				return invoke();
			});
		return next;
	};
	return invoke;
}

/**
 * Wraps an async function so calls run one at a time in call order, and a
 * failed call never blocks the ones queued behind it. Arguments are captured
 * when a call is made, so the last call's payload is the last one applied.
 *
 * ```ts
 * const write = sequential((content: string) => writeFile(statePath, content));
 * void write("a"); // starts
 * void write("b"); // waits for "a", then lands last
 * ```
 */
export function sequential<Args extends unknown[]>(
	fn: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
	let tail: Promise<void> = Promise.resolve();
	return (...args: Args) => {
		tail = tail.catch(() => {}).then(() => fn(...args));
		return tail;
	};
}
