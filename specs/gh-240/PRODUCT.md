# Multiple notes open at once as tabs

## Summary

Desktop users can keep several Markdown Files open at once as a row of tabs above the editor, and switch between them with a click, the arrow keys, or `CmdOrCtrl+Alt+[` / `]`. One tab is visible at a time; there is no split view. Each tab keeps its own back/forward trail. Tabs are a working set for the current session, not a saved layout.

## Problem

Hubble shows one Markdown File at a time. A user running several agent conversations at once — each about a different note — can only see one of those notes, and loses track of which terminal session belongs to which note. The terminal panel already has session tabs; the notes do not.

Back/forward does not solve this. History is a linear trail that truncates the moment the user branches off it, so returning to "the other two notes I am working on" means re-finding them in the sidebar and destroying the forward trail. `CmdOrCtrl+P` finds a file but does not keep it. Neither is a place to leave something.

Running two copies of the app over one folder is not a workaround: two instances writing the same files risks clobbering while the sync engine is in progress.

## Goals

1. Keep several Markdown Files open and switch between them in one click, without re-finding them in the sidebar.
2. Give each tab its own back/forward trail, so following a link in one tab does not disturb another.
3. Make the open set visible at a glance, so the user can tell which notes are in play.
4. Cost a user who never opens a second note nothing but one row: no change to how notes load, save, or navigate, and no extra step to reach the editor by keyboard.

## Non-goals

1. **No split view and no second window.** One note is visible at a time. Both shapes were raised on the issue; the reporter confirmed tabs are what is wanted.
2. **No dirty indicator on the tab.** Hubble autosaves, so "unsaved" is not a state a background tab can be in. See Design Context.
3. **No terminal session bound to a tab.** Terminal sessions are scoped to the open folder, live outside the app store, and cannot have their note path changed once running. Tracked separately.
4. **Tabs do not survive relaunch.** Consistent with ADR-0008 and with the back/forward trail, which is also session-only. Relaunch restores the last opened Markdown File as a single tab, exactly as today.
5. **No preserved undo history across a tab switch.** Undo lives in the editor instance, not in app state, so it resets exactly as it does when navigating today. Scroll position *is* preserved — see Design Context.
6. **No two tabs on the same Markdown File.** Opening a file that is already open focuses its tab.
7. No drag-to-reorder, no pinned tabs, no preview tabs, no tab groups.
8. **No opening a tab in the background, and no select-by-position shortcut.** `CmdOrCtrl+T`, `CmdOrCtrl`-click, and `CmdOrCtrl+1`–`9` are all worth having and none of them is load-bearing: opening a note already gives it a tab, and stepping with `CmdOrCtrl+Alt+[` / `]` reaches every tab. They are left out to keep the first version to one row and three commands.

## Design Context

**Switching tabs is navigation.** A tab records a path; activating it runs the same save-and-load Hubble already performs when the user clicks a note in the sidebar. This keeps one open document, one file watcher, and one editor — the shape ADR-0008 describes, where the sidebar index is ephemeral and the app keeps a single direct watcher on the currently open file. Giving each tab its own live buffer would mean a watcher per open tab, which is the unbounded watcher graph ADR-0008 rejects.

**This is the direction comparable editors have converged on.** Obsidian — Electron, Markdown files on disk, tabs — moved from a live view per tab to a deferred placeholder that materializes on activation in v1.7.2, and exposes it as `WorkspaceLeaf.isDeferred` / `loadIfDeferred()`. On external changes, no mainstream editor watches every open file: VS Code runs one recursive workspace watcher plus per-file watchers only for files outside the workspace, jEdit and IntelliJ revalidate when a tab regains focus. A live buffer per tab is also actively hazardous for an autosaving app, because two tabs on one file become two buffers writing to one path on a timer, last write winning silently — which is why opening an already-open file focuses its tab instead.

**Scroll position is kept, undo is not.** Editors treat these as different layers: scroll and cursor are view state keyed by file and cached independently of any tab (VS Code holds a capped cache of them and restores on reopen), while undo belongs to the editor instance. Hubble can afford the first cheaply — remember the scroll offset per path on leaving, restore it on arriving — and cannot afford the second without an editor mounted per tab.

**Autosave makes a dirty indicator meaningless.** There is no Save command; edits are written shortly after typing stops. A background tab is therefore never unsaved, and a dot on the active tab would be visible for a fraction of a second. The one durable state worth surfacing — an external change conflicting with local edits — already has a banner, and under this design can only ever apply to the visible tab.

**This depends on a save fix.** Leaving a note today relies on the editor flushing its pending edit as it unmounts, and that flush is discarded because the open path has already changed by the time it runs. Tabs make leaving a note a routine, one-click action, so the fix lands first: saving becomes an explicit step in navigation rather than a side effect of unmounting.

**Vocabulary.** `CONTEXT.md` gains **Tab** and **Active Tab**; the codebase has no term for an open note today.

## Behavior

### Opening

1. With a Workspace Folder or Plain Folder open, the tab strip appears above the editor as soon as one Markdown File is open, and stays for every note after it.
2. Choosing a file deliberately gives it a tab: the sidebar and `CmdOrCtrl+P`. The tab becomes active. The file picker and creating a new file stay on the Active Tab for now, so they replace it as they do today.
3. Following a wiki link or a relative link stays in the Active Tab and extends that tab's trail. Reading through linked notes is one train of thought, not a pile of tabs; Back is the way out of it.
4. Opening a Markdown File that is already open in another tab activates that tab instead of opening a second one.
5. A new tab is inserted after the Active Tab.

### Switching

6. Clicking a tab activates it. `CmdOrCtrl+Alt+[` / `]` step to the previous and next tab, wrapping at each end. The strip is one stop in the page's tab order rather than one per note; from there the arrow keys move along it, and `Home` and `End` reach its ends.
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
18. When tabs exceed the available width the strip scrolls horizontally, and the Active Tab is always scrolled into view.
19. The strip is hidden only when no Markdown File is open. It does not appear on the second note: arriving then would shove the editor down under the pointer mid-click, which reads as a glitch rather than as a note opening.

## UX Validation

1. Open a folder with several Markdown Files. Confirm the strip appears with the first file and shows one tab.
2. Click a second file in the sidebar. Confirm a second tab appears after the first and is active. Open a third, then switch between all three by clicking and with `CmdOrCtrl+Alt+[` / `]`. Confirm one `Tab` press from the editor reaches the strip, and that the arrow keys move along it from there.
3. Type into tab 2 continuously and immediately click tab 1. Switch back and confirm every character survived.
4. Scroll halfway down a long note in tab 1, switch to tab 2, and switch back. Confirm the scroll position is where it was left.
5. In tab 1 follow a wiki link, then switch to tab 2 and follow a different link. Confirm Back in each tab returns along that tab's own trail, and that Back enablement changes as tabs change.
6. Edit a note in tab 2, change the same file outside Hubble, return to tab 2, and confirm the conflict banner appears and switching away is refused until it is resolved.
7. Rename a file open in a background tab from the sidebar. Confirm that tab's label updates and activating it opens the renamed file.
8. Delete a file open in a background tab. Confirm the tab closes, then undo the delete and confirm it reopens.
9. Open two files with the same name from different folders. Confirm both tabs show enough path to distinguish them.
10. Open enough tabs to overflow the strip. Confirm it scrolls and the Active Tab stays visible.
11. Close tabs with `CmdOrCtrl+W` until none remain. Confirm the empty state, then that a further `CmdOrCtrl+W` closes the window.
12. Switch to a different folder with several tabs open, then switch back. Confirm tabs reset to that folder's last-opened file.
