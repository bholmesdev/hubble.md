# Global search across Markdown Files

## Summary

Global search gives desktop users one palette, opened with `CmdOrCtrl+P`, that finds Markdown Files in the open folder two ways at once: fuzzy matching on file names and paths, and literal matching on file content. Selecting a result opens that Markdown File.

## Problem

The sidebar helps only when the user already knows the file name and can spot it in the tree. It answers "where is `meeting-notes.md`?" but not "which note mentioned Pagefind?". Today the second question sends users to `rg` in a terminal, or to a different app entirely.

## Goals

1. Find a Markdown File by name or path without knowing its exact spelling or location.
2. Find a Markdown File by a phrase inside it, with enough surrounding text to recognize the right hit.
3. Reach both from a single entry point, without the user first choosing which kind of search they want.
4. Stay responsive on a large open folder, and stay honest when results are capped.

## Non-goals

1. No jump-to-match. Selecting a content result opens the Markdown File at its top, not at the matching line. Mapping a source offset to a position in the rich editor is a separate problem.
2. No regular expressions, no case-sensitivity toggle, no whole-word toggle. Content matching is literal and case-insensitive.
3. No search across File Properties as structured fields. Front matter is matched only as raw text, like any other part of the file.
4. No web surface in this slice. `apps/www` is unchanged. The shared palette component is built so web can supply its own content search later.
5. No replace, and no multi-file editing.
6. No persistent search index, and no new filesystem watcher.

## Design Context

The entry point is a modal command palette, not a sidebar panel. Hubble already has two `cmdk`-driven command menus — the Slash Command menu and the `CmdOrCtrl+/` Format Command menu — so the interaction vocabulary (type to filter, arrow keys to move, `Enter` to run, `Escape` to dismiss) is established. Global search reuses it at app scope instead of editor scope.

`CmdOrCtrl+F` is already the in-note Find bar and `CmdOrCtrl+K` is already link insertion. `CmdOrCtrl+P` is free, and carries the "quick open" meaning from other editors.

Search reads the same file list the sidebar shows. Per ADR-0008, that list is an ephemeral snapshot: it respects `.gitignore` and `.ignore`, prunes `.git/`, `dist/`, and `node_modules/`, and refreshes on window focus or `File > Sync Workspace` rather than through a live watcher. Search inherits that contract exactly rather than building a parallel view of the folder. A file the sidebar cannot see is a file search cannot find, and both become correct again at the same moment.

## Behavior

### Opening and dismissing

1. With a Workspace Folder or Plain Folder open, `CmdOrCtrl+P` opens the search palette, and `File > Go to File…` does the same.
2. When no folder is open — including when a Loose File is the current document — `CmdOrCtrl+P` does nothing and the menu item is disabled.
3. The palette opens with an empty query and the text input focused.
4. `Escape` or a click outside dismisses it and returns focus to the previously focused element.
5. Dismissing discards the query. Reopening starts empty.

### Searching

6. With an empty query, the palette lists recently modified Markdown Files from the current snapshot, most recent first, so the palette is useful before the user types anything.
7. Typing one or more characters matches file names and paths immediately, with no perceptible delay. A match on the file name ranks above a match that only appears elsewhere in the path.
8. Typing three or more characters additionally searches file content. Content results appear shortly after name results, and the palette does not block, reorder, or clear the name results while content search is running.
9. Name and path matching is fuzzy: the typed characters must appear in order but need not be adjacent, and separators such as spaces, hyphens, and underscores are ignored. Content matching is literal and case-insensitive.
10. Results are grouped, with name and path matches shown before content matches. A Markdown File that matches both ways appears once, under name matches.
11. Each name result shows the file name and its folder path relative to the open folder, with the matched characters emphasized.
12. Each content result shows the file name and a readable one-line excerpt with inline Markdown syntax stripped and the matched text emphasized in context. The line number is returned in the payload but not rendered until jump-to-line is implemented. When a file matches on several lines, at most three excerpts are shown for that file.
13. Content search covers Markdown Files only. Name and path search also covers HTML Apps, since they are openable documents in the sidebar.
14. While content search is running, the palette shows a quiet in-progress indication. Changing the query abandons the in-flight search rather than queueing another.

### Results and limits

15. Selecting a result with `Enter` or a click opens that Markdown File in the editor and dismisses the palette. This is the same navigation the sidebar performs, and it participates in document history the same way.
16. Arrow keys move the highlight across all groups as one list. The first result is highlighted on open.
17. When a query matches nothing, the palette says so plainly and offers no result rows.
18. Content search stops after 50 matching files. When it stops early, the palette states that results were capped rather than presenting a partial list as complete.
19. Files larger than 2 MiB are skipped by content search. This is not surfaced per-file; it is documented behavior.
20. A file that has changed on disk since the last snapshot refresh may be missing from results, or may show a stale excerpt. This resolves on the next focus refresh or `File > Sync Workspace`, exactly as it does for the sidebar.
21. Search never reaches outside the open folder, and never reads a path the sidebar snapshot does not already list.

## UX Validation

1. Open a folder containing at least a few dozen Markdown Files across nested folders.
2. Press `CmdOrCtrl+P`. Confirm the palette opens focused and empty, listing recently modified files.
3. Type a partial, misspelled-by-omission file name (e.g. `mtgnts` for `meeting-notes.md`). Confirm the file appears, with matched characters emphasized.
4. Type a phrase you know appears inside exactly one note and nowhere in any file name. Confirm a content result appears with a readable excerpt and inline Markdown syntax stripped.
5. Press `Enter` on that content result. Confirm the palette closes and the correct Markdown File opens.
6. Type a query matching many files. Confirm results appear promptly and, if capped, that the palette says results were capped.
7. Type quickly and continuously. Confirm no stale result set ever replaces a newer one, and the palette never flickers back to older matches.
8. Add a `.gitignore` entry covering one note, trigger `File > Sync Workspace`, and confirm the note leaves both the sidebar and search.
9. Close the folder, open a Loose File, and confirm `CmdOrCtrl+P` does nothing and the menu item is disabled.
