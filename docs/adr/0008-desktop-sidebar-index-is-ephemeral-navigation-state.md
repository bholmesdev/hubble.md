# Desktop sidebar index is ephemeral navigation state

Opening a large repo root in Hubble Desktop can make the app unresponsive if the app recursively watches every directory in the open folder. The sidebar file tree is useful navigation state, but it is not the source of truth for which files can be viewed.

We choose to treat the desktop sidebar file list as an ephemeral snapshot. Electron main owns the initial discovery for the current workspace and keeps a native, non-blocking recursive event stream where the platform supports it. Rename events are reconciled as bounded file entries or directory subtrees; ordinary content changes are ignored. It respects `.gitignore` and `.ignore`, and always prunes known high-cost folders such as `.git/`, `dist/`, and `node_modules/`.

The watcher setup must not await a discovery pass or build a user-space watcher graph. If native recursive watching is unsupported or fails, Hubble falls back to window-focus refresh and `File > Refresh Folder`. Ambiguous events, including a missing filename, may schedule a full refresh as a recovery path. File operations initiated inside Hubble continue to update the sidebar through existing app actions.

The active editor file is different. Hubble keeps a direct non-recursive watcher on the currently open file so external edits can still trigger the existing disk-change conflict behavior.

Folder expansion in the sidebar is presentational. Expanding a folder reveals paths from the current snapshot; external directory additions scan only that subtree. Ignored files and files outside the sidebar snapshot can still be opened when the user explicitly picks them or when Hubble restores a readable last-opened file. Ignore rules filter sidebar discovery; they are not an access boundary. Ignore-file changes reconcile the affected directory subtree.

The first implementation will not persist the sidebar snapshot between app launches. Rebuilding the snapshot on boot avoids stale-cache invalidation for renamed folders, deleted files, changed ignore rules, and Hubble version changes.

## Consequences

- This refines ADR-0001 for desktop local folders: the editor can be usable even when sidebar navigation is stale or still refreshing.
- The current file may have no matching selected row in the sidebar.
- Visible external additions, deletions, and renames are reflected through incremental deltas when native recursive watching is active.
- Focus refresh and `Refresh Folder` remain full-refresh backstops.
- Closing and reopening Hubble recrawls the open folder.
- Sidebar absence is not equivalent to file deletion; a file can leave the sidebar because ignore rules changed.
- Recursive watcher exhaustion from eager user-space discovery is avoided for large folders.

## Rejected recursive watcher design

Commit `437ff66` removed the original watcher after it proved unsafe for large workspaces. That implementation recursively collected every ignore rule, then made Chokidar recursively walk the workspace and build its own watcher/path graph. It listened to Markdown `change` events, refreshed the full sidebar crawl for every event, and rebuilt the entire watcher when `.gitignore` or `.ignore` changed. The duplicate tree traversals caused beachballs during workspace open and could exhaust watcher resources.

The rejection remains: do not restore eager user-space recursive discovery, an unbounded watcher graph, or full rescans for ordinary events. The accepted refinement is limited to the platform's native recursive event stream, bounded incremental deltas, and an explicit focus/manual-refresh fallback when native coverage is unavailable.

## Deferred optimizations

- Persist the sidebar snapshot and validate it on next boot with cache versioning, file mtimes, and ignore-file mtimes.
- Stream partial results into the sidebar instead of replacing the snapshot after each crawl.
- Prioritize crawling expanded or visible folders if streaming results are introduced.
- Add bounded subtree watchers only for small or expanded folders, with a hard watcher budget, if native coverage proves insufficient.
- Add an optional Watchman backend behind the same refresh interface for very large folders.
- Use Git-backed discovery for Git folders with `git ls-files --cached --others --exclude-standard`.
