# Desktop tab implementation

## State and ownership

`apps/desktop/src/store/tabs.ts` owns tab types and pure updates. A tab holds a path, not document contents. `TabsState` holds ordered ids, the active id, path records, and recently closed paths with their former positions.

`DocumentState` remains the single loaded document. Activating a tab uses the existing save-and-load path, so the app keeps one editor and one watcher for the visible file. Background tabs need neither buffers nor per-file watchers. This preserves the watcher model in ADR-0008.

`tabSession` serializes ordered paths, the active path, and up to `MAX_CLOSED_TABS` closed entries. `persistence.ts` validates sessions with Zod and stores them per workspace in local storage. Hydration creates the tab records synchronously; `restoreTabs` checks file existence and loads the active document asynchronously. The virtual changelog bypasses disk checks and uses bundled Markdown.

## File operations

`loadPath` accepts an optional tab target: the active tab by default, a specific id, or `"new"`. It updates the tab and document together after loading succeeds. Activation and restoration pass `launchExternal: false` so a code-file preference cannot send tab navigation to another app.

`leaveCurrentDocument` flushes and saves outgoing edits. Conflicts and failed writes block the operation. The existing latest-request guard prevents stale loads from replacing newer navigation.

- `openTabForPath` selects an existing tab or opens a new one.
- `openBackgroundTab` inserts a path without reading its contents.
- `closeTab` records a closed entry only after leaving succeeds, then loads a neighbour if needed.
- `reopenClosedTab` queues repeated requests, skips missing paths, and consumes an entry only after its document is shown. A workspace switch invalidates queued requests.
- Rename and move operations share their path rewrites with tabs, navigation history, and scroll memory.
- Delete actions remove matching tabs without recording user closes. Delete undo uses before/after snapshots to restore the layout when later tab changes have not superseded it.

## Navigation and view state

`historyStore.byTab` holds each tab's back/forward trail. These trails remain in memory and are discarded on close or workspace switch. A single `isNavigating` flag protects the shared document from concurrent history operations.

Scroll positions live in a bounded path-keyed cache, so reopening a file can restore its position even with a new tab id. Capture occurs before replacing the shared editor content; restore retries while the editor lays out. Workspace switches clear the cache. Editor undo history is not cached.

## UI

`WindowTitleBar` owns the full-width window drag region, sidebar toggle, `DocumentTabs`, and `AllTabsMenu`. `FileInfoBar` contains the file title and controls below it. `EditableFileTitle` is shared with the web toolbar without coupling either bar to the other's layout.

`DocumentTabs` maps store state to the prop-driven `TabStrip` in `packages/ui/src/components/tabbar`. `useTabDrag` previews insertion with transforms and commits on release. The active tab stays above dragged inactive tabs.

A resize observer detects when each tab would be narrower than 48px. The strip remains laid out but becomes hidden and inert; `animateTabs` moves its tabs into All Tabs, then returns them when space allows. Both directions use the same easing. The collapsing animation briefly reveals the All Tabs label. Animation cleanup cancels outstanding work, and reduced-motion preferences skip it.

The file palette receives pinned command ids in new-tab mode, promoting the existing New File command with its normal shortcut. Creation, file selection, and sidebar actions pass the appropriate tab target rather than replacing the active document first.

## Commands and menus

Command defaults and enablement live in `packages/editor/src/commandRegistry.ts`; renderer commands and native Electron menus use that registry. `tabCount` enables close at one tab and next/previous at two; `hasClosedTabs` enables reopening. The window-close menu action closes a tab when one exists and otherwise closes the window.

## Checks

- Store tests cover save-before-navigation, target selection, independent history, workspace persistence, closed-tab restore, and file operations.
- UI tests cover tab keyboard controls, renaming, drag previews/cancellation, and collapsed state.
- Run `pnpm build:desktop` and `pnpm check:react-compiler` before review, plus relevant existing tests.
- In Electron, verify editing followed by immediate switching, conflicts, drag order, palette creation, crowded-tab animation, and workspace restore.

## Remaining limits

Switching can wait on disk and resets editor undo history and view mode. Terminal sessions remain workspace-scoped. Preserving undo across tabs or binding a terminal to a tab requires separate work.
