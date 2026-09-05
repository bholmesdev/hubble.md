# Multiple notes open at once as tabs — technical plan

## Context

Issue: https://github.com/bholmesdev/hubble.md/issues/240

Product spec: `specs/gh-240/PRODUCT.md`

Current commit researched: `c4235c9eeae77958d966d2fe7c44ce91e5a89aca`

Desktop holds exactly one open document: `DocumentState` in `apps/desktop/src/store/state.ts`, reached through `viewerStore` and `currentPathStore`, and read from roughly 200 call sites across 17 files. Navigation is already centralized on `loadPath` / `loadInternalPath` in `apps/desktop/src/store/actions.ts`; back/forward stacks are keyed per open folder in `apps/desktop/src/store/history.ts`; one non-recursive watcher follows the open file in `apps/desktop/src/App.tsx`. `packages/ui` is prop-driven and has no store coupling.

**Prerequisite.** Leaving a note relies on the editor flushing its debounced save as it unmounts (`packages/ui/src/editor/EditorView.tsx`). That flush is discarded: `loadInternalPath` writes the new path into the store before React unmounts the editor, so `savePathContentNow` sees `current.currentPath !== path` and returns. Typing without a pause and then clicking another note loses the burst. Verified in the running app — a control run that pauses before navigating saves, an otherwise identical run that does not pause loses the text, reproducibly. Filed separately; tabs make leaving a note a routine action, so the fix lands first and this plan builds on it.

## Decision: no per-tab document buffers

Two shapes were considered and rejected before this one. Both give every tab a live `DocumentState` — either by mirroring the active buffer into a map, or by replacing `document` with a map plus a hand-written store facade over the active entry — and so give every tab live content, a live conflict state, and a live dirty flag.

They were rejected because:

- The single-document assumption is load-bearing in reads, not only in writes. `savePathContentNow`, `updateMovedLinks`, and the auto-title liveness checks in `apps/desktop/src/store/titleManagement.ts` all mean "the only document" today and would quietly come to mean "the focused document" — dropping saves for a backgrounded tab, corrupting a background draft during a folder rename, and permanently stopping auto-titling for a note the user switched away from. All three keep compiling.
- Background buffers go stale unless each is watched. The open-file watcher is singular by design (`desktop:watch-path` in `apps/desktop/electron/main.ts`, commented "Only the active file uses this watcher"), and chokidar watching a file watches that file, so N tabs means N `fs.watch` handles. A real cost, though a bounded one — this is weaker than ADR-0008's case against the sidebar's unbounded recursive graph, and is listed as a cost rather than a blocker.
- They churn the roughly 110 `viewerStore` references and 19 `document:` seeding sites in `apps/desktop/src/store/actions.test.ts`.

Hubble autosaves, so once the prerequisite fix makes leaving a note reliably flush, **a background tab has no state to hold beyond its path**. A tab becomes a remembered path plus a back/forward trail, activating a tab is the save-and-load Hubble already performs, and `DocumentState` is untouched.

This is also where comparable editors have ended up. Obsidian moved from a live view per tab to a deferred placeholder materialized on activation in v1.7.2 (`WorkspaceLeaf.isDeferred` / `loadIfDeferred()`). No mainstream editor watches every open file — VS Code pairs one recursive workspace watcher with per-file watchers only for files outside the workspace, and jEdit and IntelliJ revalidate on tab focus instead. For an autosaving editor specifically, a buffer per tab is hazardous rather than merely costly: two tabs on one path become two buffers writing to that path on a timer.

Tradeoff accepted: activating a tab re-reads from disk and resets undo and view mode. Undo would not survive under the rejected shapes either — it lives in Tiptap, not in `DocumentState`, so preserving it needs an editor mounted per tab under any design. Scroll position is kept, but as view state keyed by path rather than as part of a tab (see Approach).

## Approach

### Tab state

Add one slice to `DesktopState`:

```ts
tabs: { order: TabId[]; activeTabId: TabId | null; byId: Record<TabId, { path: string }> }
```

`TabId` is a generated opaque id, not the path. `editorDocumentId` already establishes that a note's path is not its identity, and auto-titling renames a new note within half a second of creation. Ids are minted from a module counter so tests stay deterministic under `vi.resetModules()`.

Not added to `Persisted` or `serialize()` in `apps/desktop/src/store/persistence.ts`. `document.lastOpenedPath` keeps its current meaning and still restores a single tab on launch.

### `loadInternalPath` as the chokepoint

Extract the save-and-abort preamble `navigateHistory` already performs into `leaveCurrentDocument()`: save the open file from store content, and report back if a conflict is present or is discovered by that save. Call it at the top of `loadInternalPath` so every entry point gets it — sidebar clicks, wiki links, `CmdOrCtrl+P`, and tab activation alike. `navigateHistory` and `openChangelog` then call the shared helper instead of duplicating it.

This is what makes the design safe: saving becomes an explicit step in navigation rather than a side effect of unmounting an editor.

Extend `loadPath` options with a target tab. The default is the Active Tab, so existing callers are unchanged; an explicit option mints a new one. Write the tab slice inside `loadInternalPath` beside `withOpenedDoc`, and **only on the success path** — the toast branch deliberately stays on the current document, so writing the tab earlier would leave the strip pointing at a file that failed to open. The silent-missing branch closes the target tab instead.

Two details that bite here. Tab activation must pass `launchExternal: false`, as `navigateHistory` already does: without it, activating a tab holding a code file launches an external app and never switches. And `openChangelog` never goes through `loadInternalPath` at all — it writes `currentPath` directly — so it is deliberately excluded from the tab model: the changelog takes over the editor without a tab, and activating any tab leaves it. That is the one place `activeTabId` and `document.currentPath` are allowed to differ, so clicking the already-active tab must reload rather than no-op.

### History re-keyed from open folder to tab

`historyStore.byWorkspace` becomes `byTab`. This is small and it ships with tabs rather than after them: `byWorkspace` appears in only two places outside `history.ts`, every `canGoBack` / `canGoForward` call site passes zero arguments and so is unaffected by the parameter's meaning changing, and `mapHistory` already sweeps every key blindly, so rename and delete rewriting stays correct unchanged. `historyKey()` and `LOOSE_HISTORY_KEY` delete outright — a tab always has an id, so the loose-file sentinel has nothing to represent. The only edit outside `history.ts` is `useHistoryNav` in `store/hooks.ts`, which subscribes to the active tab id instead of the workspace path. Closing a tab deletes its stack.

Deferring this would not be a smaller first change, it would be a broken one: every activation pushes onto the single trail, so Back in one tab would load a file opened in another, and enablement would be identical across tabs and never change on switch — contradicting Behavior 8.

`isNavigating` stays a single global boolean. With one `DocumentState` there is only ever one navigation in flight; making it per tab would permit a race that the global flag currently prevents.

History also stays in its own `historyStore` rather than moving onto the tab record. Folding it into `appStore` would look tidier for lifecycle, but delete-undo snapshots and restores `historyStore` wholesale, and that cheap snapshot would have to be reworked into the `appStore` undo path.

Behaviour change worth noting: back/forward trails no longer survive an open-folder switch, because tabs reset with the folder.

### Rewriting tabs with existing file operations

Rename, move, and delete already rewrite `workspace.lastOpenedPaths` and `document.currentPath` inside one `appStore.set`. Each gains the same treatment for `tabs.byId`: `renameMarkdownFile`, `renameFolder`, and `moveSidebarItem` in `actions.ts`, plus `publishRename` in `titleManagement.ts`, which rewrites paths for auto-titled notes and is the one most easily missed. Note these four do not share a path comparison — exact equality, `replacePathPrefix`, and `pathEquals` respectively — so each takes the rewrite function it already uses rather than a single shared helper.

Delete closes matching tabs rather than rewriting them, across the three paths in `apps/desktop/src/store/deleteActions.ts`. Undo needs to restore them: `reopenPath` is recorded only when the deleted file was the visible one, so it cannot reopen a background tab. The pending deletion snapshots the whole `tabs` slice before and after, and restores the before if nothing has rearranged the strip since — the same shape as the history snapshot beside it, which restores positions exactly without tracking them.

### Scroll position as view state

Scroll is kept in a small module-level cache keyed by path — written when leaving a document, read when one is opened — not stored on the tab. Keyed by path rather than by tab, it also survives closing and reopening a file, and it stays correct if a tab is closed while the file remains open elsewhere. Capped, and dropped on workspace switch. This is the layer split editors settle on: view state outlives both the tab and the editor instance, while undo belongs to the editor.

### UI and menu

Pure tab logic — the state shape and the functions over it — lives in `apps/desktop/src/store/tabs.ts`, which `state.ts` imports rather than the reverse. Keeping it out of `state.ts` is what lets it be tested without standing up the store.

The tab strip is a prop-driven component in `packages/ui`, keeping that package free of store coupling, with a thin container in `apps/desktop` supplying order, labels, and the active id. It mounts in `Toolbar` as `centerSlot`, replacing the file-name control; double-click rename lives on the Active Tab. Interactive tab chrome is `no-drag`; unused top-bar space stays a window drag region, including the macOS traffic-light inset. Label disambiguation and next-active-tab-on-close are pure functions, unit-tested directly.

Sidebar plain clicks call `loadPath` (Active Tab). `CmdOrCtrl`-click calls `openBackgroundTab`, which mints a path-only tab to the right without loading it. `+` and `CmdOrCtrl+T` open the existing file palette with a new-tab flag; choosing a file then calls `openTabForPath`. Plain `CmdOrCtrl+P` still calls `loadPath`. `CmdOrCtrl`-click is removed from sidebar multi-select; `Shift`-click range select stays.

Commands go in `packages/editor/src/commandRegistry.ts`, with palette entries in `useAppCommands.ts` and native menu items in `apps/desktop/electron/main.ts`. `CmdOrCtrl+W` currently maps to the window `close` role in the File menu and needs to close a tab first, falling back to closing the window when none are open. `MenuState` gains tab enablement. No manual memos — CI runs `pnpm check:react-compiler`.

## What does not change

- `DocumentState`, `viewerStore`, `currentPathStore`, and every existing read and write of them.
- One open document, one editor instance, one file watcher on the open file.
- `packages/ui` store purity; `apps/www` and `apps/web`.
- `Persisted` / `serialize()` — no tab state on disk, so no schema migration.
- The 19 `document:` seeding sites in `actions.test.ts`, and every existing assertion in it.

## E2E test plan

Desktop, on the running app (`apps/desktop/.claude/skills/test-desktop-app`), following `specs/gh-240/PRODUCT.md` § UX Validation. The load-bearing ones:

1. Type continuously in one tab, switch immediately, switch back — no lost text. This is the prerequisite fix, and the regression most worth guarding.
2. Build a link trail in two tabs independently; confirm Back follows each tab's own trail and enablement tracks the Active Tab.
3. Conflict a file, then attempt to switch away — refused, banner stays.
4. Rename, move, and delete a file open in a background tab; undo the delete.
5. Switch open folders with several tabs open, and back again.

Unit and integration:

- Pure helpers: next active tab after close, label disambiguation, tab rewrite and prune.
- `actions.test.ts`: `leaveCurrentDocument` saves before load and aborts on conflict; `loadPath` tab targeting; per-tab history isolation; rename rewrites a background tab; delete closes matching tabs; opening an already-open path focuses its tab.
- Tab strip component under the existing `// @vitest-environment happy-dom` and `createRoot` + `act` precedent.

Commands: `pnpm check` while iterating, `pnpm --filter @hubble.md/desktop test`, `pnpm check:react-compiler` after React changes, `pnpm build:desktop` before review.

## Risks

- **Tab switch costs a disk read** and can reach the delayed loading state on slow volumes. Same cost as a sidebar click today; accepted rather than mitigated.
- **Undo history and view mode reset on switch.** The most likely user complaint. Not fixable without an editor mounted per tab, which is a separate change; called out as a non-goal rather than left to be discovered.
- **`CmdOrCtrl+W` overriding the window close role** is easy to get wrong on macOS. Covered by UX Validation step 10.
- **Auto-titling still stops when the user leaves a new note** inside its rename window. Unchanged from today, but tabs make leaving more frequent. Worth a follow-up rather than widening this change.

## Follow-ups

- Bind a terminal session to a tab — the original motivation. Needs a main-process change to retarget a running session.
- Persist the open tab set across relaunch.
- Preserve undo history across a tab switch, which needs an editor mounted per tab.
- Preview tabs: one replaceable slot per strip, promoted on edit, so browsing does not accumulate tabs.
- Drag to reorder tabs.
- Keep auto-titling alive after navigating away from a new note.
