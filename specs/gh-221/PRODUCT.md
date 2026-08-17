# Folder-aware Markdown templates

## Summary

Hubble lets users keep reusable Markdown templates in visible `templates` Folders, discover the templates available to the current note, insert them additively, and choose a default for new Markdown Files. Templates, File Properties, and Assets remain portable filesystem content.

`templates` folders can exist anywhere in the folder tree. Templates available to a given note are based on the cascade of `templates` folders up the chain:

```sh
templates/
    main.md
    journal.md
notes/
    meetings/
        templates/
            main.md
        2026-05-08.md
    entry-2.md
```

Here, `2026-05-08.md` has these templates available:

- `templates/main.md`
- `templates/journal.md`
- `meetings/templates/main.md`

And `entry-2.md` has these templates:

- `templates/main.md`
- `templates/journal.md`

## Flows

### Find and apply a template

1. The user creates or opens a Markdown File in a Workspace Folder or Plain Folder.
2. They type `/template` and see templates collected from `templates` Folders between the note's Folder and the open-folder root.
3. They search or select a template; Hubble adds its missing File Properties and inserts its body at the Slash Command location.

- Every visible Folder named `templates`, case-insensitively, is a Template Library with no opt-in marker; every Markdown File recursively inside it is a template. Existing ignore rules still apply.
- Templates from the nearest Template Library appear first. Same-named templates remain separate choices, with their internal path and owning Folder shown as secondary text.
- The picker shows filenames without `.md`; default templates show a **Default** badge. Template Libraries and files remain visible and editable in the sidebar.
- Command-P name and content search keeps templates available but ranks an equally relevant ordinary note above a template.
- If `/template` is the only content in its paragraph, the body replaces that paragraph. Otherwise, the body is inserted after the current top-level block.
- File Property names match case-sensitively. Existing properties keep their value and type; missing properties append in template order. Arrays, tags, and nested values are not merged; `default-template` is never added.
- Applying a template copies its associated Assets into the target note's Asset Folder and adjusts Markdown, HTML, Asset, and Wikilink references as needed to preserve their resolved targets.
- Application is atomic. Invalid template or target front matter changes nothing and shows an error toast; invalid template front matter offers **Edit template**. An unreadable template shows an error without that action.
- While editing a template, `/template` remains available for composition but omits the current file. Loose Files have no Folder context, so `/template` is unavailable.

### Create a Markdown File from a default

1. The user sets `default-template: true` on a template through File Properties.
2. They create a Markdown File through any Desktop new-file entry point.
3. Hubble applies the effective default before opening the independent new file.

- Setting a default through Hubble unchecks other defaults in the same Template Library.
- The nearest Template Library containing a valid default wins. If it contains multiple defaults after external edits, the alphabetically first library-relative path wins silently.
- Default resolution starts from the actual creation destination; a Folder focused when the keyboard shortcut runs therefore contributes its local and inherited defaults.
- With no valid default, creation remains blank.
- Template content never influences the filename. Existing unique `new-file.md`, inline rename, save, and open behavior remain unchanged.
- A failure to read or apply the chosen default creates no partial Markdown File or Assets and shows an actionable error toast.
- Creating a Markdown File anywhere inside a Template Library instead creates blank `new-template.md` with `default-template: false`; inherited defaults do not apply.

### Save a note as a template

1. From a Markdown File's overflow menu, the user selects **Save as template**.
2. Hubble creates `templates` beside the note when needed, copies the note and its complete associated Asset Folder, and opens the copy.
3. The copy keeps the source filename and content, uses a collision-safe filename when needed, and has `default-template: false`.

- Relative references keep resolving to the same targets; the source remains unchanged and **Save as template** is hidden when already editing a template.
- The copy is atomic; invalid source front matter or filesystem failure leaves no partial template or Asset Folder and shows an error toast.
- Template Markdown Files and Assets participate in Cloud Sync like ordinary workspace files.
- Desktop supports template actions in this slice. Synced templates remain visible and editable on web, but web template actions are deferred.

## Out of scope

- HTML App templates or defaults.
- Dynamic variables, prompts, scripts, or generated values.
- Property replacement, deep merging, or retroactive template updates.
- Web `/template`, default creation, or Save as template actions.
- Template behavior for Loose Files.

