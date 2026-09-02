# Changelog

All notable user-facing changes to Hubble. Entries are written as work lands
(see the `changelog` skill), then harvested into the desktop release notes.

Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added

### Changed

- The app window now appears about 200ms sooner on launch, already in the right theme, instead of staying hidden behind a bouncing dock icon until the whole app had loaded. [#279](https://github.com/bholmesdev/hubble.md/issues/279)
- The desktop download is smaller: the app bundle dropped from 131 MB to 56 MB and the app code itself is half the size, so updates download faster. [#279](https://github.com/bholmesdev/hubble.md/issues/279)

### Fixed

## [0.1.28] - 2026-08-19

### Added

- Customize keyboard shortcuts from Settings. Thanks [@Mamdouh66](https://github.com/Mamdouh66)! [#204](https://github.com/bholmesdev/hubble.md/pull/204)

## [0.1.27] - 2026-08-16

### Added

- Add a spellcheck option to Settings. Allows for enabling / disabling, and selecting custom spellcheck dictionaries on Windows and Linux. Thanks [@JoeJoeflyn](https://github.com/JoeJoeflyn)! [#234](https://github.com/bholmesdev/hubble.md/pull/234)

### Changed

- Sidebar folders stay alphabetized while files are sorted by Recent or Name. Thanks [@n00ki](https://github.com/n00ki)! [#258](https://github.com/bholmesdev/hubble.md/pull/258)

### Fixed

- Sidebar keyboard focus stays on the same file or folder when sorting changes. [#267](https://github.com/bholmesdev/hubble.md/pull/267)
- Code blocks scroll horizontally instead of wrapping long lines. Thanks [@ggbao666](https://github.com/ggbao666) for the suggestion! [#260](https://github.com/bholmesdev/hubble.md/pull/260)
- Clicking elsewhere in a note now closes the formatting menu and clears its old text highlight. [#256](https://github.com/bholmesdev/hubble.md/pull/256)
- Pinned notes remain visible after restarting or updating the desktop app. [#254](https://github.com/bholmesdev/hubble.md/pull/254)
- Pressing Enter in a list item containing an image now creates a new list item instead of dropping out of the list. Thanks [@MonisMS](https://github.com/MonisMS)! [#241](https://github.com/bholmesdev/hubble.md/pull/241)

## [0.1.26] - 2026-08-09

### Added

- New notes name themselves from the first meaningful line as you type, until you choose a name yourself. [#244](https://github.com/bholmesdev/hubble.md/pull/244)

### Changed

- New notes and HTML Apps are created inside the focused sidebar folder. [#247](https://github.com/bholmesdev/hubble.md/pull/247)
- Open recent workspaces with Ctrl+R, and add folders with Cmd+Shift+O. [#243](https://github.com/bholmesdev/hubble.md/pull/243)
- Desktop controls adapt to narrow windows with an overlay sidebar and compact action menus. [#245](https://github.com/bholmesdev/hubble.md/pull/245)

### Fixed

- Sidebar rows now use one focus-aware highlight, so folders and open notes no longer appear selected at the same time. Thanks [@JoeJoeflyn](https://github.com/JoeJoeflyn)! [#235](https://github.com/bholmesdev/hubble.md/pull/235)
- Window controls now align with the app header on Windows and Linux. Thanks [@JoeJoeflyn](https://github.com/JoeJoeflyn)! [#236](https://github.com/bholmesdev/hubble.md/pull/236)
- Scrollbars now match the selected light or dark theme. Thanks [@ggbao666](https://github.com/ggbao666) for the suggestion! [#239](https://github.com/bholmesdev/hubble.md/pull/239)

## [0.1.25] - 2026-08-06

### Added

- Find and run Hubble commands alongside note results in the search palette. Thanks [@zcuric](https://github.com/zcuric)! [#209](https://github.com/bholmesdev/hubble.md/pull/209)

### Fixed

- Keyboard navigation keeps the selected slash command in view. Thanks [@ggbao666](https://github.com/ggbao666) for the report! [#223](https://github.com/bholmesdev/hubble.md/pull/223)
- Images in list items and table cells no longer disappear after reopening a note. Thanks [@parthiv-krishna](https://github.com/parthiv-krishna) for the report! [#225](https://github.com/bholmesdev/hubble.md/pull/225)

## [0.1.24] - 2026-08-02

### Added

- Keep the sidebar in sync when files and folders are added, deleted, or renamed outside Hubble. Thanks [@Mamdouh66](https://github.com/Mamdouh66) for the suggestion! [#202](https://github.com/bholmesdev/hubble.md/pull/202)
- Undo accidental file and folder deletions from the confirmation toast or with Cmd+Z. Thanks [@Siffrico](https://github.com/Siffrico) for the suggestion! [#218](https://github.com/bholmesdev/hubble.md/pull/218)

### Fixed

- Open File (Cmd+O) only lets you pick a file, so choosing a folder no longer fails to open. [#215](https://github.com/bholmesdev/hubble.md/pull/215)

## [0.1.23] - 2026-07-29

### Added

- Replace text from the find bar: swap the current match or every match at once. Press Cmd+Alt+F to open replace, and Cmd+Z to take back one replacement at a time. Thanks [@Mamdouh66](https://github.com/Mamdouh66) for the suggestion! [#200](https://github.com/bholmesdev/hubble.md/pull/200)
- Choose a Light, Dark, or System default appearance in the new General settings section. The choice sticks across launches and only follows the operating system when System default is picked. Thanks [@camilom](https://github.com/camilom) for the suggestion! [#197](https://github.com/bholmesdev/hubble.md/pull/197)

## [0.1.22] - 2026-07-27

### Added

- Recent folders can be removed from the workspace switcher without affecting their files. Hover a folder and click the x, or press Delete while it's highlighted. Thanks [@saucy-tech](https://github.com/saucy-tech)! [#196](https://github.com/bholmesdev/hubble.md/pull/196)
- Open the current note in Codex or Claude from the note actions menu, with the workspace and note path already filled in. [#188](https://github.com/bholmesdev/hubble.md/pull/188)
- Browse every workspace file, edit plain text and code, view PDFs and images in Hubble, and open any file in its default app. Thanks [@zcuric](https://github.com/zcuric) for the suggestion! [#183](https://github.com/bholmesdev/hubble.md/pull/183)
- Hubble now collects anonymous usage data to help improve the app, with a clear notice and a Settings toggle to opt out. See [TELEMETRY.md](https://github.com/bholmesdev/hubble.md/blob/main/TELEMETRY.md) for what's collected. [#182](https://github.com/bholmesdev/hubble.md/pull/182)
- Leave review comments on a note: highlight text to start a thread, reply to it, and resolve it when it's handled. Comments live in the Markdown itself, so they travel with the file. Thanks [@hwong103](https://github.com/hwong103)! [#175](https://github.com/bholmesdev/hubble.md/pull/175)
- Browse every comment in a note from the toolbar, filter by unresolved or resolved, and copy a prompt handing the open threads to your agent. For the best results, install the [review-markdown-comments skill](https://github.com/bholmesdev/hubble-skills/blob/main/skills/review-markdown-comments/SKILL.md) with `npx skills add bholmesdev/hubble-skills --skill review-markdown-comments`, so your agent knows how to reply and resolve them. Thanks [@hwong103](https://github.com/hwong103)! [#175](https://github.com/bholmesdev/hubble.md/pull/175)

### Changed

- Dragging files in the sidebar now shows what you're moving: a "Move 3 items" label for a selected group, the whole group dimmed as it travels, and a clearer highlight on the folder or workspace root you're dropping into. Thanks [@zcuric](https://github.com/zcuric)! [#198](https://github.com/bholmesdev/hubble.md/pull/198)

## [0.1.21] - 2026-07-18

### Added

- HTML Apps can use `./` and `../` paths to access Markdown files relative to the app. [#177](https://github.com/bholmesdev/hubble.md/pull/177)

### Changed

- Workspaces with the same folder name now show their parent paths in the workspace switcher, making them easier to distinguish. Thanks [@hwong103](https://github.com/hwong103) for the suggestion! [#181](https://github.com/bholmesdev/hubble.md/pull/181)
- HTML Apps can now be edited in source mode from the file menu or keyboard shortcut. [#178](https://github.com/bholmesdev/hubble.md/pull/178)
- Editor blocks now use a consistent reading rhythm, with tighter list grouping and clearer heading separation. [f6c44a2](https://github.com/bholmesdev/hubble.md/commit/f6c44a2)

### Fixed

- Switching between notes now keeps navigation controls stable and saves pending edits to the correct file. [#167](https://github.com/bholmesdev/hubble.md/pull/167)

## [0.1.20] - 2026-07-12

### Added

- Global search: press Cmd+P (or File → Go to File…) to find notes by name, by path, or by a phrase inside them. Results show a matching excerpt, and selecting one opens the note. Thanks [@zcuric](https://github.com/zcuric)! [#159](https://github.com/bholmesdev/hubble.md/pull/159)
- Pin, unpin, or trash multiple sidebar items at once, including with Cmd+Delete. [#129](https://github.com/bholmesdev/hubble.md/pull/129)
- Added a button to view the changelog after an update. Revisit the changelog anytime from Help or Settings. [#163](https://github.com/bholmesdev/hubble.md/pull/163)

### Fixed

- macOS text context menus now include Writing Tools, text services, and spelling suggestions. Thanks [@noahpatterson](https://github.com/noahpatterson) for the suggestion! [#164](https://github.com/bholmesdev/hubble.md/pull/164)
- Update-check failures now show a concise, unobtrusive message instead of a raw error trace.

## [0.1.19] - 2026-07-11

### Added

- Linux desktop builds now ship an RPM package alongside the existing AppImage and deb, for install on Fedora/RHEL/openSUSE and other RPM-based distros. Thanks [@ricardoraposo](https://github.com/ricardoraposo)! [#151](https://github.com/bholmesdev/hubble.md/pull/151)
- Dark mode: the desktop app, editor (including code-block syntax highlighting), and embedded HTML apps now follow your system appearance. Thanks [@saucy-tech](https://github.com/saucy-tech)! [#110](https://github.com/bholmesdev/hubble.md/issues/110)
- Go back and forward between recently opened files: use the toolbar arrows, Cmd+[ and Cmd+], or the View menu. History is kept per workspace and follows files through renames, moves, and deletes. [#154](https://github.com/bholmesdev/hubble.md/pull/154)

### Fixed

- Copying linked rich text now preserves hyperlinks when pasted into other rich text editors. Thanks [@snvtac](https://github.com/snvtac)! [#149](https://github.com/bholmesdev/hubble.md/issues/149)

## [0.1.18] - 2026-07-07

### Added

- Edit a note's raw Markdown with source mode: toggle from the note's ⋯ menu or press Cmd+Option+U. [#144](https://github.com/bholmesdev/hubble.md/pull/144)
- Dock the terminal panel to the right side of the window: right click the terminal tab bar and pick a position. [#148](https://github.com/bholmesdev/hubble.md/pull/148)

## [0.1.17] - 2026-07-06

### Added

- Selecting text now shows a floating formatting toolbar for bold, italic, strikethrough, links, headings, lists, and quotes. Thanks [@hwong103](https://github.com/hwong103)! [#108](https://github.com/bholmesdev/hubble.md/issues/108)
- Copy selected editor content as Markdown from the Edit menu or editor context menu. Thanks [@jambronner](https://github.com/jambronner)! [#122](https://github.com/bholmesdev/hubble.md/pull/122)
- Terminal panel in the desktop app: toggle with Cmd+J to run shell commands in your workspace, with tabs, drag resize, and double click to rename. Thanks [@israelvf](https://github.com/israelvf)! [#131](https://github.com/bholmesdev/hubble.md/pull/131)
- Chat about the open note with your agent CLI: pick it from the note's ⋯ menu or press Cmd+Shift+J, and customize the command in Settings. [#139](https://github.com/bholmesdev/hubble.md/pull/139)
- Add table support. Markdown tables now render as expected, and you can create new tables using `/table`. There are still editing features left to add, like adding and removing rows. Track progress on GitHub: [#99](https://github.com/bholmesdev/hubble.md/issues/99). Thanks [@israelvf](https://github.com/israelvf)! [#130](https://github.com/bholmesdev/hubble.md/pull/130)
- Create HTML Apps from the new file dropdown, folder menus, and the File menu. [#141](https://github.com/bholmesdev/hubble.md/pull/141)
- Empty HTML App files show a setup screen with the skill install command and a ready-to-copy agent prompt, with a check once the skills are detected. [#141](https://github.com/bholmesdev/hubble.md/pull/141)

### Changed
- Keyboard shortcut hints now show the correct keys on Windows and Linux (Ctrl/Alt instead of macOS symbols). [#137](https://github.com/bholmesdev/hubble.md/pull/137)
- More buttons and menus now show their keyboard shortcut, including the format and slash command menus. [#137](https://github.com/bholmesdev/hubble.md/pull/137)
- The HTML Apps popup in new workspaces is gone; setup now happens when you create an HTML App. [#141](https://github.com/bholmesdev/hubble.md/pull/141)

### Fixed
- Desktop saves no longer drop trailing content in notes with multibyte characters. [#127](https://github.com/bholmesdev/hubble.md/pull/127)
- Relative Markdown file links now open the linked file instead of showing an invalid URL error. [#145](https://github.com/bholmesdev/hubble.md/pull/145)
- Bold, italic, and strikethrough selections with boundary spaces now save as valid Markdown (`**bold** next`, not `**bold **next`). Thanks [@luchopcerra](https://github.com/luchopcerra)! [#128](https://github.com/bholmesdev/hubble.md/pull/128)

## [0.1.16] - 2026-06-27

### Added
- Find text in the editor with highlighted matches and next/previous navigation
- Sidebar rows can now be multi-selected and moved together

### Fixed
- Editor word and character counts now reflect the selected text

## [0.1.15] - 2026-06-27

### Added
- Windows desktop builds (NSIS installer)

### Fixed
- HTML Apps and local images now load correctly on Windows
- Creating files/folders and revealing them in the file manager now work on Windows (paths are no longer doubled)

## [0.1.14] - 2026-06-25

### Added

- Linux desktop builds (AppImage and Debian package)
- Native window controls (minimize, maximize, close) on Windows and Linux

### Fixed
- Creating or renaming nested sidebar folders now keeps the folder tree in the expected shape
- The HTML Apps walkthrough video now loads in the packaged desktop dialog
- New task-list items created with Enter now start unchecked

## [0.1.13] - 2026-06-24

### Added
- You can now adjust the window zoom with `⌘=/⌘-/⌘0`

### Changed
- Sidebar folders now reflect real workspace directories, including empty folders, while hiding Hubble-owned config and asset folders

### Fixed
- App title now always shows Hubble instead of the starter template name
- Top bar no longer reserves empty space for the traffic lights in fullscreen

## [0.1.12] - 2026-06-23

### Changed
- New app icon
- Lowercase hubble wordmark on the welcome screen

### Fixed
- Pressing Enter at the end of a link no longer carries the link onto the next line

## [0.1.11] - 2026-06-21

### Added
- HTML Apps: view and run interactive HTML apps directly in the editor
- File APIs so HTML apps can read and write workspace files
- First-run onboarding with an HTML Apps callout
- Hubble now remembers your window size and position between launches
- Web homepage at hubble.md

### Changed
- Refreshed the desktop app icon
- Larger default window size on first launch
- Restyled task list checkboxes

### Fixed
- Slash menu no longer hides behind surrounding UI
