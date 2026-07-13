# Global search across Markdown Files — technical plan

## Context

Issue: https://github.com/bholmesdev/hubble.md/issues/117

Product spec: `specs/gh-117/PRODUCT.md`

Current commit researched: `28cdd402dcb7e25adac184686c80eae4a1e19a5b`

Desktop file discovery already exists: `collectDocumentFiles` (`apps/desktop/electron/main.ts`) walks the open folder, applies `.gitignore` / `.ignore` via `rulesForDir`, prunes `ignoredWorkspaceDirs` (`.git`, `dist`, `node_modules`) and hidden sidebar folders, and returns a flat `DirectoryListing` of `{ path, modified_at }`. It is exposed as `desktop:list-directory`, consumed by `refreshFiles` (`apps/desktop/src/store/actions.ts`) and parked in `workspaceStore.files`. Every path-taking IPC handler gates on `assertGranted` / `assertGrantedRoot` against the granted-scope allowlist. File reads go through `desktop:read-file-text`. `hasDocumentExtension` (`apps/desktop/src/lib/filePath.ts`) is markdown-or-html; `hasMarkdownExtension` is markdown alone.

`loadPath` (`apps/desktop/src/store/actions.ts`) is the single chokepoint for "navigate the editor to this path", shared by the sidebar, wiki links, and HTML App `files.open`.

Two `cmdk` command menus exist in `packages/ui/src/editor/`: `SlashCommandMenu.tsx` and `FormatCommandMenu.tsx`. Both set `shouldFilter={false}` and filter through a hand-rolled `commandScore` / `isSubsequence` / `normalize` trio (`SlashCommandMenu.tsx`) that ranks exact `1` > prefix `0.9` > substring `0.75` > subsequence `0.45`. `FormatCommandMenu` is the closer precedent: a real `Command.Input` with its own `query` state, opened from a `keymatch`-based global `keydown` listener. App-level shortcuts live in one handler in `apps/desktop/src/App.tsx`; `CmdOrCtrl+P` is unbound. `Modal` (`packages/ui/src/primitives/modal.tsx`) wraps `@base-ui/react/dialog`.

## Decision: naive search, no dedicated index

The issue asks us to choose between naive on-demand search and a dedicated content index, and to weigh Pagefind. We choose **naive on-demand search on both surfaces**, and reject Pagefind.

**Pagefind is the wrong shape.** It is a build-time indexer: a CLI crawls built HTML output and emits a WASM runtime plus static index fragments. Hubble has no build step over user content, and that content mutates on every keystroke. The parts of Pagefind worth learning from are its ranking behavior and its excerpt-with-context presentation, not its architecture.

**Web would not benefit from an index.** The Convex `files` table already stores `content: v.string()` inline (`packages/sync-backend/convex/schema.ts`), and `getFilesByWorkspace` returns full rows. `loadPath` in `apps/www/src/store/actions.ts` does not fetch one file — it calls `backend.getFiles(workspaceId)` and `.find()`s the path, because every note body is already resident in client memory. Adding a Convex `.searchIndex()` would build a server-side index to search data the client already holds. When web lands, its content search is an in-memory scan.

**Desktop's cost is bounded, and an index would fight ADR-0008.** A persistent content index needs invalidation, and the only cheap invalidation signal is a recursive watcher — precisely what ADR-0008 rules out. Instead, content search reads the paths the sidebar snapshot already lists, on demand, debounced and abortable. Search then inherits ADR-0008's staleness contract for free: it sees exactly what the sidebar sees, and both become correct at the same moment. No second view of the folder, no cache to invalidate, no watcher.

The load this accepts is a full read of the candidate set per settled keystroke, concurrency-limited and abortable, with the OS page cache absorbing repeats. Measured on 2,000 markdown files totalling 16 MiB (concurrency 8, warm cache, Apple silicon):

| query | matching files | median |
| --- | --- | --- |
| no match (full scan, worst case) | 0 | 44 ms |
| rare needle | 20 | 49 ms |
| common needle | capped at 50 | 1 ms |

The worst case is a full scan, and it costs ~45 ms — comfortably inside the 150 ms debounce, so a settled keystroke never queues behind the previous search. A common needle is *faster*, not slower, because the `MAX_RESULT_FILES` cap short-circuits the walk almost immediately. If a larger corpus ever misses this budget, the escalation is a main-process content cache keyed by `path → { mtimeMs, content }` and validated by `stat` — strictly cheaper than a real index, and still no watcher. That is a deferred optimization, listed below, not part of this slice.

## Approach

### Renderer sends the paths; main never walks

The renderer already holds the snapshot in `workspaceStore.files`. Content search passes those paths to main rather than asking main to re-walk the folder. This is what makes "search sees exactly what the sidebar sees" true by construction instead of by convention, and it keeps `collectDocumentFiles` as the single place that decides what is visible.

Main still calls `assertGranted` on every path it is handed. A compromised renderer gains nothing.

### IPC: `desktop:search-file-contents`

Add to `DesktopApi` (`apps/desktop/src/desktopApi/types.ts`), preload (`electron/preload.ts`), and `registerIpc` (`electron/main.ts`):

```ts
export type SearchContentMatch = {
	line: number;        // 1-indexed
	excerpt: string;     // stripped inline Markdown, window around the first match
	matchStart: number;  // offset into excerpt
	matchEnd: number;
};

export type SearchFileResult = {
	path: string;
	matches: SearchContentMatch[]; // capped at MAX_MATCHES_PER_FILE
};

export type SearchFileContentsOutput = {
	requestId: number;
	results: SearchFileResult[];
	truncated: boolean; // hit MAX_RESULT_FILES
};

searchFileContents(input: {
	requestId: number;
	paths: string[];
	query: string;
}): Promise<SearchFileContentsOutput>;
```

Main-process implementation:

- Keep a module-level `latestSearchRequestId`. On entry, record `requestId`; between files, bail out if it is no longer the latest. This is real cancellation — an AbortSignal cannot cross IPC.
- Filter `paths` to `hasMarkdownExtension`, then `assertGranted` each.
- `stat` each candidate; skip when `size > MAX_FILE_BYTES`.
- Read with a concurrency pool of `SEARCH_CONCURRENCY`.
- Match case-insensitively on a literal needle. No regex: it avoids ReDoS on user input and avoids the question of which dialect we promise.
- Per file, collect up to `MAX_MATCHES_PER_FILE` matches, each with a payload line number and an excerpt with inline Markdown syntax stripped, windowed to `EXCERPT_CONTEXT_CHARS` either side of the match. The palette does not render the line number until jump-to-line is implemented.
- Stop after `MAX_RESULT_FILES` files have matched, and set `truncated: true`.

Constants, in one place in main: `MAX_FILE_BYTES = 2 * 1024 * 1024`, `MAX_RESULT_FILES = 50`, `MAX_MATCHES_PER_FILE = 3`, `SEARCH_CONCURRENCY = 8`, `EXCERPT_CONTEXT_CHARS = 40`.

Errors on individual files (deleted between snapshot and read, permission denied) are skipped, not thrown. A stale snapshot must not fail the whole search.

### Fuzzy path scoring

New `packages/ui/src/lib/fuzzy.ts`, unit-tested:

- `scoreText(query, haystack): number` — the existing exact/prefix/substring/subsequence ladder, extracted in behavior but written fresh here.
- `matchRanges(query, haystack): Array<[start, end]>` — character ranges to emphasize in the UI. The existing menus do not need this; the palette does.
- `scorePath(query, relativePath): number` — `max(scoreText(query, basename), 0.8 * scoreText(query, relativePath))`, so a basename hit outranks a hit that only exists in a parent folder name.

`normalize` strips whitespace, `-`, and `_`, matching the existing menus. It leaves `/` intact so path separators stay meaningful.

Do **not** refactor `SlashCommandMenu` and `FormatCommandMenu` onto this module in this slice. Their scorer is entangled with command keywords and aliases, and changing their ranking is an unrelated regression risk. Deduplicating them is a follow-up.

### Shared palette component

New `packages/ui/src/components/GlobalSearchPalette.tsx`, presentational, with content search injected:

```ts
type Props = {
	open: boolean;
	onOpenChange(open: boolean): void;
	files: Array<{ path: string; modified_at: number }>; // current snapshot
	rootPath: string;                                    // to render relative paths
	onSelectFile(path: string): void;
	searchContents(query: string): Promise<{
		results: SearchFileResult[];
		truncated: boolean;
	}>;
};
```

Name and path matching runs synchronously in the component over `files`, so it lands on the first keystroke. `searchContents` is debounced by `SEARCH_DEBOUNCE_MS = 150` and gated on `query.length >= MIN_CONTENT_QUERY_LENGTH = 3`. Content results land in separate state, so they never clear or reorder name results while in flight; a stale resolve is discarded by comparing against the current query.

Files that already matched by name are filtered out of the content group, satisfying "appears once, under name matches."

Rendering follows `FormatCommandMenu`: `Command` with `shouldFilter={false}`, a real `Command.Input`, `Command.List`, two `Command.Group`s. Arrow-key traversal and `Enter` come from `cmdk` for free, which is why the two groups render as one navigable list.

The palette does **not** reuse `Modal`. `Modal` is `max-w-md`, vertically centered, and renders a title/close header — a palette wants to be wider, anchored toward the top, and chromeless. It composes `@base-ui/react/dialog` directly, matching `Modal`'s backdrop and animation classes. Spacing uses logical properties throughout.

### Desktop wiring

- `apps/desktop/src/App.tsx`: add `CmdOrCtrl+P` to the existing `keymatch` chain, guarded by `workspaceStore.get().workspacePath` the same way `CmdOrCtrl+Shift+O` is. Open-only, never toggle: the File menu accelerator fires alongside the renderer keydown, exactly as it already does for `CmdOrCtrl+Shift+O`, and only an idempotent open survives that. Render `<GlobalSearchPalette>` with `files` from `workspaceStore`, `onSelectFile` → `loadPath`, and `searchContents` → a thin wrapper over `desktopApi.searchFileContents` that supplies a monotonically increasing `requestId` and the current snapshot's paths.
- `electron/main.ts` `buildMenu`: add `Go to File…` to the File submenu with accelerator `CmdOrCtrl+P`, enabled from the existing `MenuState.hasWorkspace`. New IPC `onMenuGoToFile`, following `onMenuShowWorkspaceSwitcher`.
- Because `loadPath` is the navigation chokepoint, search results participate in document history (gh-111) with no extra work.

## What does not change

- No new watcher, and no change to `collectDocumentFiles` or the snapshot refresh triggers.
- No Convex schema change, no `.searchIndex()`, no `SyncBackend` method. `apps/www` is untouched.
- `SlashCommandMenu` and `FormatCommandMenu` keep their own scorer.
- `Modal` is unchanged.
- No change to `loadPath`'s signature or behavior.

## E2E test plan

Desktop (running app; use the `test-desktop-app` skill when automating):

1. Open a folder with nested Markdown Files. `CmdOrCtrl+P` opens the palette, focused and empty, showing recently modified files. `Escape` closes it and restores focus.
2. Type a subsequence of a file name with characters omitted; confirm the file ranks and matched characters are emphasized. Confirm a basename match outranks a parent-folder-only match.
3. Type a phrase present in exactly one note's body and in no file name; confirm one content result with a readable excerpt and inline Markdown syntax stripped. `Enter` opens that file.
4. Type continuously and fast; confirm no older result set ever replaces a newer one, and name results never blank out while content search runs.
5. Create a folder with more than 50 files containing a common phrase; confirm the capped-results message appears.
6. Add a note to `.gitignore`, run `File > Sync Workspace`, and confirm the note disappears from both sidebar and search.
7. With no folder open (and with a Loose File open), confirm `CmdOrCtrl+P` does nothing and `Go to File…` is disabled.
8. Delete a file on disk without refreshing, then search for its content; confirm the search completes without error and simply omits it.

Unit:

- `packages/ui/src/lib/fuzzy.test.ts`: the score ladder, separator normalization, `scorePath` basename preference, `matchRanges` offsets including the subsequence case.
- Main-process matcher, extracted as a pure function over `(content, query)`: line numbers, excerpt windowing at line start / line end / mid-line, per-file match cap, case-insensitivity.

Commands:

- Iteration: `pnpm check`
- Final: `pnpm build:desktop`

## Risks

- **Content search is slow on a very large folder.** Mitigated by the debounce, the concurrency pool, `MAX_FILE_BYTES`, `MAX_RESULT_FILES`, and real `requestId` cancellation. Measured at ~45 ms worst case over 2,000 notes (see above). Re-measure if the corpus grows an order of magnitude; if it misses, the content cache below is the next move, not an index.
- **Stale excerpts.** Search reads from disk while the path list comes from a snapshot that may lag. The excerpt is therefore current and the path list is not. This is ADR-0008's contract, stated in the product spec rather than papered over.
- **Blocking the main process.** Reads are async and pooled, but a pathological folder could still starve the event loop. If it does, move the matcher to a `utilityProcess` behind the same IPC signature.
- **base-ui keeps `Dialog.Popup` mounted after close**, and that single fact caused two distinct bugs, both found by driving the running app rather than by tests. Verified that `Modal` shares the mounted-when-closed behavior, so both traps are latent in `packages/ui/src/primitives/modal.tsx` too and should be addressed separately.
  - *Ghost clicks.* At `opacity: 0` the popup still hit-tests, so a click in the middle of the editor landed on an invisible result row and opened whichever file sat under the cursor. Fixed with `data-[closed]:pointer-events-none` on both the popup and the backdrop.
  - *Dead second open.* `autoFocus` on the input fires only on mount, so the second `CmdOrCtrl+P` left the caret in the editor: the palette rendered but swallowed every keystroke and `Enter` selected nothing. Fixed with base-ui's `initialFocus={inputRef}` on `Dialog.Popup`, which runs on every open. A manual `focus()` in an effect is *not* sufficient — it races base-ui's own focus management and lands the focus non-deterministically.
- **`CmdOrCtrl+P` on web later.** It is browser print. When web lands, either bind `CmdOrCtrl+K` there or accept `preventDefault`. Out of scope now, but do not let a shared component hard-code the chord.

## Follow-ups

- Web surface: implement `searchContents` over the already-resident `getFiles` content and mount the same palette in `apps/www`.
- Jump to the matching line when opening a content result. Needs a source-offset to ProseMirror-position mapping; genuinely hard in the rich editor, and near-free in source mode (gh-142).
- Main-process content cache keyed by `path → { mtimeMs, content }`, validated by `stat` before read.
- Send the path list once per palette session instead of per query, if the IPC payload ever shows up in a profile.
- Deduplicate the fuzzy scorer across `SlashCommandMenu`, `FormatCommandMenu`, and `fuzzy.ts`.
- Search File Properties as structured fields rather than raw front matter text.
