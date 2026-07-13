# Changelog

All notable user-facing changes to Hubble. Entries are written as work lands
(see the `changelog` skill), then harvested into the desktop release notes.

Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added

### Changed

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
