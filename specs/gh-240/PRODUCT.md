# Multiple notes open at once as tabs

## Summary

Desktop users can keep several Markdown Files open at once as tabs in the top bar — replacing the file name — and switch between them with a click, the arrow keys, or `CmdOrCtrl+Alt+[` / `]`. One tab is visible at a time; there is no split view. Each tab keeps its own back/forward trail. Tabs are a working set for the current session, not a saved layout.

## Problem

Hubble shows one Markdown File at a time. A user running several agent conversations at once — each about a different note — can only see one of those notes, and loses track of which terminal session belongs to which note. The terminal panel already has session tabs; the notes do not.

Back/forward does not solve this. History is a linear trail that truncates the moment the user branches off it, so returning to "the other two notes I am working on" means re-finding them in the sidebar and destroying the forward trail. `CmdOrCtrl+P` finds a file but does not keep it. Neither is a place to leave something.

Running two copies of the app over one folder is not a workaround: two instances writing the same files risks clobbering while the sync engine is in progress.

## Goals

1. Keep several Markdown Files open and switch between them in one click, without re-finding them in the sidebar.
2. Give each tab its own back/forward trail, so following a link in one tab does not disturb another.
3. Make the open set visible at a glance in the top bar, so the user can tell which notes are in play.
4. Leave single-note browsing unchanged: a plain sidebar click or `CmdOrCtrl+P` still replaces the note on screen.

## Non-goals

1. **No split view and no second window.** One note is visible at a time. Both shapes were raised on the issue; the reporter confirmed tabs are what is wanted.
2. **No dirty indicator on the tab.** Hubble autosaves, so "unsaved" is not a state a background tab can be in. See Design Context.
3. **No terminal session bound to a tab.** Terminal sessions are scoped to the open folder, live outside the app store, and cannot have their note path changed once running. Tracked separately.
4. **Tabs do not survive relaunch.** Consistent with ADR-0008 and with the back/forward trail, which is also session-only. Relaunch restores the last opened Markdown File as a single tab, exactly as today.
5. **No preserved undo history across a tab switch.** Undo lives in the editor instance, not in app state, so it resets exactly as it does when navigating today. Scroll position *is* preserved — see Design Context.
6. **No two tabs on the same Markdown File.** Opening a file that is already open focuses its tab, or leaves the existing tab in place when the open is unfocused.
7. No drag-to-reorder, no pinned tabs, no preview tabs, no tab groups.

## Design Context

**Switching tabs is navigation.** A tab records a path; activating it runs the same save-and-load Hubble already performs when the user clicks a note in the sidebar. This keeps one open document, one file watcher, and one editor — the shape ADR-0008 describes, where the sidebar index is ephemeral and the app keeps a single direct watcher on the currently open file. Giving each tab its own live buffer would mean a watcher per open tab, which is the unbounded watcher graph ADR-0008 rejects.

**This is the direction comparable editors have converged on.** Obsidian — Electron, Markdown files on disk, tabs — moved from a live view per tab to a deferred placeholder that materializes on activation in v1.7.2, and exposes it as `WorkspaceLeaf.isDeferred` / `loadIfDeferred()`. On external changes, no mainstream editor watches every open file: VS Code runs one recursive workspace watcher plus per-file watchers only for files outside the workspace, jEdit and IntelliJ revalidate when a tab regains focus. A live buffer per tab is also actively hazardous for an autosaving app, because two tabs on one file become two buffers writing to one path on a timer, last write winning silently — which is why opening an already-open file focuses its tab instead.

**Scroll position is kept, undo is not.** Editors treat these as different layers: scroll and cursor are view state keyed by file and cached independently of any tab (VS Code holds a capped cache of them and restores on reopen), while undo belongs to the editor instance. Hubble can afford the first cheaply — remember the scroll offset per path on leaving, restore it on arriving — and cannot afford the second without an editor mounted per tab.

**Autosave makes a dirty indicator meaningless.** There is no Save command; edits are written shortly after typing stops. A background tab is therefore never unsaved, and a dot on the active tab would be visible for a fraction of a second. The one durable state worth surfacing — an external change conflicting with local edits — already has a banner, and under this design can only ever apply to the visible tab.

**This depends on a save fix.** Leaving a note today relies on the editor flushing its pending edit as it unmounts, and that flush is discarded because the open path has already changed by the time it runs. Tabs make leaving a note a routine, one-click action, so the fix lands first: saving becomes an explicit step in navigation rather than a side effect of unmounting.

**Vocabulary.** `CONTEXT.md` gains **Tab** and **Active Tab**; the codebase has no term for an open note today.

## Behavior

### Opening

1. With a Workspace Folder or Plain Folder open, the tab strip lives in the top bar, replacing the file name. It is visible as soon as one Markdown File is open.
2. A plain sidebar click, `CmdOrCtrl+P`, the file picker, or creating a new file replaces the Active Tab. Following a wiki link or a relative link also stays in the Active Tab and extends that tab's trail.
3. `CmdOrCtrl`-click a sidebar file to open it in a new tab immediately to the right of the Active Tab, without focusing it. The current note stays on screen. A file that already has a tab is not opened again.
4. The `+` control at the end of the strip, or `CmdOrCtrl+T`, opens the file palette in new-tab mode. Choosing a file there mints a new tab (or focuses the one already showing that file) and makes it active. A plain `CmdOrCtrl+P` still replaces the Active Tab.
5. `CmdOrCtrl`-click is not used for sidebar multi-select. `Shift`-click still range-selects. Middle-click is not an open gesture.

### Switching

6. Clicking an inactive tab activates it. Double-clicking the Active Tab's label starts an inline rename, the same role the file name in the top bar used to have. A single click on the Active Tab only keeps it selected. `CmdOrCtrl+Alt+[` / `]` step to the previous and next tab, wrapping at each end. The strip is one stop in the page's tab order rather than one per note; from there the arrow keys move along it, and `Home` and `End` reach its ends.
7. Activating a tab saves the outgoing Markdown File first. If that file has an unresolved disk conflict the switch does not run and the conflict banner stays, matching how back/forward already behaves.
8. Each tab has its own back/forward trail. Back and Forward act on the Active Tab only, and their enablement reflects that tab.
9. Switching tabs re-reads the file from disk. Scroll position is restored to where the user left that file. Undo history and the rich/source toggle reset, exactly as they do when navigating today.

### Closing

10. `CmdOrCtrl+W` closes the Active Tab; middle-click, the close control, or `Delete` from the keyboard closes a specific tab. Closing discards that tab's back/forward trail.
11. Closing the Active Tab activates its right-hand neighbour, or its left-hand neighbour if it was last.
12. Closing the final tab leaves the empty state shown when no file is open. `CmdOrCtrl+W` with no tabs open closes the window, as today.

### Files changing underneath

13. Renaming or moving a Markdown File open in any tab updates that tab in place; the tab's back/forward trail is rewritten as it already is today.
14. Deleting a Markdown File closes every tab showing it. Undoing that delete puts the strip back as it was, each reopened tab at the position it held, provided no tab has opened or closed since; otherwise the file reopens as one tab beside whatever is now open.
15. Opening a different folder closes all tabs and opens that folder's last-opened Markdown File, as today.
16. The changelog note ("What's new") is not a file on disk and does not get a tab. It takes over the editor with the tab strip unchanged, and activating any tab leaves it — matching how it already replaces the open note today.

### Presentation

17. A tab shows the file name without its extension. When two open tabs would show the same name, both also show enough of the parent folder to tell them apart.
18. Tabs start at a comfortable width and shrink together as more open. When they reach a readable minimum the strip scrolls horizontally; dashed edges mark leftover tabs the same way the editor marks vertical overflow. The Active Tab stays scrolled into view. The `+` control stays outside the scrolling strip.
19. Right-side toolbar controls stay on the right. The window remains draggable from the unused part of the top bar, including the macOS traffic-light inset.

## UX Validation

1. Open a folder with several Markdown Files. Confirm the top bar shows one tab where the file name used to be.
2. Click a second file in the sidebar. Confirm the Active Tab now shows that file and no extra tab appeared. `CmdOrCtrl`-click a third file. Confirm a new tab appears to the right of the Active Tab and the current note stays on screen.
3. Press `CmdOrCtrl+T` or click `+`. Confirm the file palette opens. Choose a file. Confirm it opens as a focused new tab. Press `CmdOrCtrl+P` and choose another file. Confirm it replaces the Active Tab.
4. Type into tab 2 continuously and immediately click tab 1. Switch back and confirm every character survived.
5. Scroll halfway down a long note in tab 1, switch to tab 2, and switch back. Confirm the scroll position is where it was left.
6. In tab 1 follow a wiki link, then switch to tab 2 and follow a different link. Confirm Back in each tab returns along that tab's own trail, and that Back enablement changes as tabs change.
7. Double-click the Active Tab's label. Confirm it becomes an inline rename field. A single click must not start a rename. Confirm dragging the unused part of the top bar still moves the window.
8. `Shift`-click a range of sidebar rows. Confirm they stay selected. `CmdOrCtrl`-click a file. Confirm it opens a background tab and does not toggle the multi-selection.
9. Edit a note in tab 2, change the same file outside Hubble, return to tab 2, and confirm the conflict banner appears and switching away is refused until it is resolved.
10. Rename a file open in a background tab from the sidebar. Confirm that tab's label updates and activating it opens the renamed file.
11. Delete a file open in a background tab. Confirm the tab closes, then undo the delete and confirm it reopens.
12. Open two files with the same name from different folders. Confirm both tabs show enough path to distinguish them.
13. Open enough tabs to overflow the strip. Confirm they shrink first, then scroll, dashed edges appear at the overflow, the Active Tab stays visible, and `+` stays reachable.
14. Close tabs with `CmdOrCtrl+W` until none remain. Confirm the empty state, then that a further `CmdOrCtrl+W` closes the window.
15. Switch to a different folder with several tabs open, then switch back. Confirm tabs reset to that folder's last-opened file.
