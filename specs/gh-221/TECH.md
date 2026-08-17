# Folder-aware Markdown templates technical plan

Product behavior: [`PRODUCT.md`](./PRODUCT.md). Issue: [#221](https://github.com/bholmesdev/hubble.md/issues/221).

## Approach

### Shared parsing and editor behavior

- Add template helpers beside `parseMarkdownFrontMatter()` in `packages/editor/src/frontMatter.ts`: recognize the boolean `default-template` directive, remove it from applied properties, and merge valid template properties into a valid target with case-sensitive, target-first, shallow semantics.
- Keep `isSimplePropertyKey()` unchanged; `default-template` already round-trips through the supported File Properties controls. Reuse `serializeFrontMatter()` so unsupported valid values remain preserved under ADR-0003.
- Extend `packages/ui/src/editor/SlashCommandMenu.tsx` with a Template command that opens a focused `cmdk` picker supplied by the host. Keep filesystem discovery outside `packages/ui` so web can provide the same interface later.
- Add a multi-block template insertion helper to `packages/ui/src/editor/slashCommandActions.ts`. Parse the prepared body with `markdownToTiptapDoc()`, replace a slash-only paragraph or insert after the current top-level block, and dispatch one ProseMirror transaction.
- Extend `EditorView` with template choices plus an async prepare callback. Before dispatching the body transaction, update `partsRef` and `frontMatterState` with merged properties so the existing `onUpdate` path emits one combined Markdown document through `onLocalChange` and `onSave`.
- Keep template application unavailable in source mode and Loose Files. The current template path is removed from its own picker; other templates remain available while editing a template.

### Desktop discovery and actions

- Add pure path/discovery helpers in `apps/desktop/src/lib/templates.ts`: classify case-insensitive `templates` path segments, find the owning Template Library, walk owner Folders to the open-folder root, and produce nearest-first choices with library-relative labels.
- Derive candidate paths from `workspaceStore.files`, the same ephemeral snapshot used by Command-P under ADR-0008. Read candidate contents on picker open and default resolution rather than adding a second recursive crawl or content cache.
- Parse candidates independently: invalid files remain picker choices but never defaults. Resolve defaults by the nearest library with valid `default-template: true` candidates, then case-insensitive library-relative path with a case-sensitive tie-break.
- Add `prepareTemplateApplication(templatePath, targetPath)` in `apps/desktop/src/store/templateActions.ts`: snapshot and validate the target/template, invoke the Asset-copy IPC, revalidate the editor identity/content before insertion, and return rebased Markdown to `EditorView`. Cancel and clean up if the user navigated or edited while preparation ran. Use Sonner's existing toast action shape to offer **Edit template** only for invalid readable templates.
- In `updateEditorContent()`, detect a valid `default-template` false→true transition before replacing `viewerStore.content`, then queue updates setting every other template in that library to `false`. Ordinary saves and direct filesystem conflicts do not normalize siblings.
- Refactor `createMarkdownFileInFolder()` in `apps/desktop/src/store/actions.ts` to resolve from its existing `parentPath`. A destination inside a Template Library writes `new-template.md` with `default-template: false`; otherwise it atomically materializes the effective default or retains blank creation.
- Do not call `titleManager.start()` for a default-populated note, preventing static template headings from driving generated filenames. Keep existing collision-safe path selection, store publication, `loadPath()`, refresh, and blank-note title behavior.
- Add `saveCurrentAsTemplate()` using valid live `viewerStore.content`, a collision-safe destination under the current note's sibling `templates` Folder, and the same bundle-copy IPC. Reject invalid source front matter, wire the action into `ActionsMenu` in `apps/desktop/src/components/Toolbar.tsx`, and omit it when the current path is already a template.
- Add `isTemplate` to `PaletteFile` in `packages/ui/src/components/GlobalSearchPalette.tsx`. Preserve fuzzy score as the primary key, then rank ordinary notes before templates, then modification time; sort content matches with the same ordinary-before-template tie-break.

### Filesystem, references, and sync

- Add a narrow `materialize-template` IPC to `DesktopApi`, `preload.ts`, and Electron main instead of exposing generic recursive copy. It accepts source/target Markdown paths, prepared content, and create-versus-existing mode.
- In Electron main, stage the complete source `<stem>.assets/` bundle beside the destination, deduplicate byte-identical hashed files, choose collision-safe names for different bytes, and publish only after every read/copy succeeds. Remove staged/new files on failure.
- Generalize `apps/desktop/src/lib/markdownLinkRewrite.ts` with copy rebasing: relative Markdown links, images, and HTML `src`/`href` preserve resolved targets; managed Asset references follow copied names; workspace-relative Wikilinks remain unchanged unless their target path is remapped.
- For new notes and Save as template, the IPC writes Markdown and Assets as one rollback-capable bundle. For insertion into an existing note, it publishes Assets before returning rebased Markdown; if editor dispatch fails, remove only Assets newly created by that request.
- No `packages/sync` or Convex schema changes: `fs-node.ts` already walks every non-dot Markdown File and image Asset, so visible `templates` trees and their `.assets` descendants sync normally and participate in delayed orphan-Asset reachability.

## E2E test plan

### Desktop

- Run `HUBBLE_DESKTOP_ENABLE_CDP=1 pnpm dev:desktop`; use the generated editable playground and CDP per `test-desktop-app`.
- Create root and nested Template Libraries containing same-named templates, File Properties, nested organizing Folders, links, and pasted images. Open a nested note, run `/template`, and confirm nearest-first ordering, Folder labels, Default badge, current-template exclusion, additive insertion placement, existing-wins properties, working links, and rendered copied images.
- Open Command-P with equally matching ordinary/template files and confirm the ordinary note ranks first while the template remains selectable; repeat with content-only matches.
- Mark root and nested defaults, focus the nested Folder, press the New File shortcut, and confirm the nested default, Assets, `new-file.md`, opening, and inline rename behavior. Check one sibling default and confirm the previous sibling becomes unchecked; create external duplicate defaults and confirm alphabetical selection without a warning.
- Focus a Template Library and create a Markdown File; confirm blank `new-template.md`, `default-template: false`, and no inherited content. Use **Save as template** on a note with Assets and relative links; confirm the local library/copy opens, links and images work, the source is unchanged, and the action is absent on the copy.
- Apply an invalid template and confirm no note/Asset change plus an error toast with **Edit template**. Make the target front matter invalid and confirm application changes nothing; cover unreadable-file messaging in integration tests where permissions are controllable.
- Repeat discovery/default creation in a Plain Folder. Open a Loose File and confirm `/template` is unavailable. Confirm new HTML Apps remain blank.

### Automated coverage and commands

- `packages/editor/src/frontMatter.test.ts`: directive recognition/removal; case-sensitive existing-wins merge; arrays, nested values, empty properties, invalid input.
- `packages/ui/src/editor/slashCommandActions.test.ts` and picker component tests: slash-only replacement, after-block insertion, property-only templates, focus/search/labels.
- `apps/desktop/src/lib/templates.test.ts`: case-insensitive libraries, recursive membership, ancestry boundary, duplicate names, current-file exclusion, deterministic defaults, Plain Folder and Windows paths.
- `apps/desktop/src/store/actions.test.ts`: focused destination defaults, blank fallback, `new-template`, title-manager exclusion, false→true sibling uncheck, invalid Save as template, actionable failures, and no partial store/file state.
- Electron integration tests: bundle copy, rebasing, hashed deduplication, byte collisions, rollback, and associated Asset Folder absence. Extend `GlobalSearchPalette` tests for template tie-breaking.
- Iteration: `pnpm check` and `pnpm check:react-compiler`. Final confidence: `pnpm build:desktop`.

## Risks

- Link corruption across Folder depths: centralize copy rebasing beside existing move rebasing and cover Markdown, HTML, Wikilink, query/hash, Windows, and Asset cases.
- Partial bundle publication: stage first, track exactly which destination paths were created, and roll back only those paths.
- Large-workspace regressions: use the existing sidebar snapshot and on-demand reads; do not add recursive watchers or full-folder scans.
- Template-seeded filename changes: explicitly bypass title management only for populated defaults and test the first subsequent user edit.

## Follow-ups

- Reuse the host-provided template picker/application contract on web.
- Add dynamic variables or prompts only through a separate template-language design.
