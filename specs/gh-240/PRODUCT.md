# Desktop tabs

## Purpose

Keep several files open in one window, with a separate back/forward trail for each tab. One document is visible at a time. Plain file browsing still uses the current tab.

## Opening and switching

- A plain sidebar click, file picker, link, or file search opens in the active tab. An already-open file selects its existing tab.
- Cmd/Ctrl-clicking a sidebar file opens a background tab beside the active tab. Shift-click still selects a range.
- The sidebar's **Open in new tab** action opens and selects a tab.
- The `+` button and Cmd/Ctrl+T open file search in new-tab mode. **New File** appears first with its configured shortcut; selecting it creates and focuses a note in a new tab.
- Clicking a tab selects it. Ctrl+Tab and Ctrl+Shift+Tab follow visual order and wrap at the ends. Arrow keys, Home, and End navigate within the tab strip.
- Dragging previews a new order; releasing commits that order and selects the dragged tab. Inactive tabs pass beneath the active tab. Escape cancels a drag.
- Double-clicking the active file tab's label starts renaming. The read-only **What's new** tab cannot be renamed.

## Navigation and saved state

- Switching saves the outgoing document before loading the next one. An unresolved conflict or failed save blocks navigation.
- Each tab has its own back/forward trail. Switching reads the target file from disk and restores its saved scroll position. Editor undo history and rich/source mode reset on navigation.
- Open paths, tab order, and the active tab persist per workspace. Returning to a workspace restores its session; missing files are skipped. An intentionally empty session stays empty.
- **What's new** opens in its own tab, uses bundled content, and restores with the other tabs.
- Renaming or moving a file updates open tab paths and navigation history. Deleting a file removes its tabs. Undoing a deletion restores the previous tab layout when no intervening tab changes prevent it.

## Closing and reopening

- Cmd/Ctrl+W closes the active tab. A tab's close button, middle-click, or Delete while navigating the strip closes that tab.
- Closing the active tab selects its right neighbour, falling back to the left. Closing the last tab leaves the empty editor. Cmd/Ctrl+W with no tabs closes the window.
- Cmd/Ctrl+Shift+T restores and selects the most recently closed tab at its former position. Each workspace retains up to 40 closed paths and positions across reloads. Missing files are skipped; failed opens stay on the stack.
- Close Other Tabs and Close All Tabs are available in the command palette. Automatic cleanup does not add entries to recently closed tabs.

## Presentation

- Chrome-style active-tab curves join the editor without a bottom divider. Inactive tabs have separators and hover feedback.
- Tab labels omit extensions, even when names match. Hover shows the path relative to the workspace, or the absolute path when outside a workspace.
- The file path and navigation, comment, terminal, and overflow controls sit in a separate ribbon below the tab bar.
- Tabs shrink together. Below 48px per tab, they animate into **All Tabs**, whose label briefly expands. The strip returns when space allows. Reduced-motion preferences skip the animation.
- All Tabs lists open files and is accessible through Cmd/Ctrl+Shift+A. Tab shortcuts are configurable.

## Out of scope

Split views, extra windows, pinned/preview/grouped tabs, editor undo across file switches, and terminal sessions bound to individual tabs.

## Validation

Check opening, switching, drag order, closing/reopening, workspace restore, rename/delete/undo, and independent navigation trails. Verify that pending edits survive a switch and failed saves block it. Check keyboard shortcuts, the New File palette entry, crowded-tab animations, reduced motion, and sidebar divider alignment at compact and normal widths.
