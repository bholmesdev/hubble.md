# LaTeX math support

## Context

Issue #124 asks for LaTeX formatting like Obsidian. `specs/gh-124/PRODUCT.md` defines the observable behavior: render inline and block math, reveal source while editing, preserve Markdown math syntax, and keep code-delimited dollars untouched.

Current editor architecture at commit `69086cff108023421b68abe74116b3f2336e0bb1`:

- `packages/editor/src/markdownToProsemirror.ts` parses Markdown with `remark-parse` and `remark-gfm`, then maps mdast nodes into TipTap JSON.
- `packages/editor/src/prosemirrorToMarkdown.ts` serializes TipTap JSON back to Markdown with explicit node and mark handling.
- `packages/editor/src/index.ts` exports framework-agnostic editor extensions and conversion helpers.
- `packages/ui/src/editor/EditorView.tsx` creates the shared TipTap editor used by desktop and web, configures StarterKit plus Hubble extensions, and saves via `tiptapDocToMarkdown`.
- `packages/ui/src/editor/EditorView.css` owns editor surface styling.
- `packages/editor/package.json` owns Markdown parser dependencies.
- `packages/ui/package.json` owns React/editor rendering dependencies.

The implementation should add math as an editor-core Markdown feature with a shared UI extension, not as desktop-specific behavior.

## Affected apps and packages

- `packages/editor`: add Markdown parse/serialize support, TipTap math node extensions, exports, and regression tests.
- `packages/ui`: render math nodes in the shared editor, style inline/block math states, and wire the extensions into `EditorView`.
- `apps/desktop`: no direct feature logic; receives behavior through `packages/ui`.
- `apps/www`: no direct feature logic; receives behavior through `packages/ui`.

## Module architecture

Use KaTeX for rendering and `remark-math` for Markdown parsing.

- Add `remark-math` to `packages/editor` so `markdownToTiptapDoc` receives `inlineMath` and `math` mdast nodes.
- Add `katex` to `packages/ui` for deterministic client-side rendering without a remote runtime.
- Add `packages/editor/src/Math.ts` with TipTap node specs:
  - `inlineMath`: inline atom-ish node with `latex` attr, rendered/editable by the UI extension.
  - `mathBlock`: block node with `latex` attr.
- Extend `markdownToProsemirror.ts`:
  - parse with `remarkMath` before `remarkGfm`;
  - map mdast `inlineMath` to `{ type: "inlineMath", attrs: { latex } }`;
  - map mdast `math` to `{ type: "mathBlock", attrs: { latex } }`.
- Extend `prosemirrorToMarkdown.ts`:
  - serialize `inlineMath` as `$<latex>$`;
  - serialize `mathBlock` as `$$\n${latex}\n$$`;
  - preserve exact LaTeX text as much as possible.
- Add `packages/ui/src/editor/MathExtension.tsx` or equivalent React node views:
  - render KaTeX output when not focused;
  - show an editable source control when selected/focused;
  - show a visible invalid-state fallback while keeping the source editable.
- Import KaTeX CSS once from the UI package build path, or copy the minimal required styles into `EditorView.css` if bundling the package CSS directly is cleaner.

## Detailed plan

1. Add dependencies.
   - `packages/editor`: `remark-math` and mdast typing updates if needed.
   - `packages/ui`: `katex` plus types if the package does not provide them.
2. Add editor-core node definitions.
   - Define `InlineMathExtension` and `MathBlockExtension`.
   - Export them from `packages/editor/src/index.ts`.
   - Keep schema attrs minimal: `{ latex: string }`.
3. Update Markdown parsing.
   - Add `remarkMath` to the unified processor.
   - Extend mdast type handling for `inlineMath` and `math`.
   - Ensure math inside code paths stays untouched because it remains `inlineCode` or `code`.
4. Update Markdown serialization.
   - Add inline and block math cases to `nodeToMarkdown` / `blockToMarkdown`.
   - Escape only delimiter-breaking cases required to avoid corrupt output; do not normalize LaTeX whitespace aggressively.
5. Add UI node views.
   - Use KaTeX `renderToString` or `render` in React-controlled node views.
   - Set `throwOnError: false` or catch render errors so invalid math does not remove source.
   - Use a compact inline source field for inline math and a code-like multiline source for block math.
   - Style with logical CSS spacing props.
6. Wire shared editor setup.
   - Add math extensions to `EditorView` before custom extension overrides.
   - Confirm both desktop and web inherit the feature.
7. Add regression coverage.
   - `packages/editor/src/MathMarkdown.test.ts` for parse and serialize roundtrips:
     - inline math in prose;
     - block math between paragraphs;
     - code and inline code dollars untouched;
     - invalid-looking source preserved.
   - UI tests only if existing editor rendering tests can cover node views cheaply; otherwise rely on manual desktop/web validation for node-view interaction.

## Testing and validation

Automated checks:

- `pnpm --filter @hubble.md/editor test -- MathMarkdown.test.ts`
- `pnpm --filter @hubble.md/editor typecheck`
- `pnpm --filter @hubble.md/ui typecheck`
- `pnpm check`
- `pnpm build:desktop`

Manual validation:

1. Run the desktop app.
2. Open a Markdown File with inline math, block math, inline code containing `$x$`, and a fenced code block containing `$$x$$`.
3. Confirm product behaviors 1-10 and 13 from `PRODUCT.md`.
4. Edit an inline expression and a block expression, save, reopen, and inspect emitted Markdown.
5. Repeat the same smoke flow in the web app using `?test=1` when the required local env is present.

## Parallelization

Sub-agents are not necessary for the first implementation. The parser, serializer, schema, and node views are tightly coupled enough that one branch should own the vertical slice. A reviewer can split follow-up UI polish after the Markdown roundtrip is stable.

## Risks and mitigations

- Dollar parsing can surprise currency text. Rely on `remark-math` behavior first, then add targeted tests for common non-math text before broad custom parsing.
- KaTeX CSS can leak globally. Scope any Hubble-specific wrapper styles under the editor root and import only KaTeX's required stylesheet once.
- React node views can create cursor traps. Keep source controls simple, support Escape/blur to return to rendered mode, and verify keyboard-only navigation.
- Serializer delimiter collisions can corrupt unusual LaTeX containing dollar delimiters. Preserve source by default and add escaping only for concrete failing cases found in tests.

## Follow-ups

- Add slash-command insertion for inline and block math.
- Add optional macro configuration if users need shared notation.
- Improve copy-as-Markdown once selection Markdown export lands.
