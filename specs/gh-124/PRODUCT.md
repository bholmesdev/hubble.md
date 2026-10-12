# LaTeX math support

## Summary

Hubble should render Markdown math expressions in the editor while preserving the original Markdown source on save. Users can write inline math with `$...$` and block math with `$$...$$`, see readable rendered math when not editing it, and still edit the underlying LaTeX source without leaving the Markdown editor.

## Problem

Users who write technical notes need Obsidian-style math support for formulas, proofs, and structured technical writing. Today Hubble treats math delimiters as plain text, so Markdown files with LaTeX are harder to read and roundtrip.

## Goals

- Support common Markdown math syntax for inline and block formulas.
- Keep the editor roundtrip stable: opening and saving a file preserves math source.
- Make math editable in place without introducing a separate source-mode surface.
- Keep non-math dollar text usable where possible.

## Non-goals

- No equation numbering, cross-references, or theorem environments.
- No WYSIWYG formula builder.
- No custom macro management UI in this slice.
- No web-only or desktop-only behavior differences.

## Behavior

1. Inline math delimited by single dollar signs renders as math inside the current paragraph, for example `$x^2 + y^2$`.
2. Block math delimited by double dollar signs renders as a standalone math block, for example `$$\int_0^1 x dx$$`.
3. Inline math stays inline with surrounding prose and does not force paragraph breaks.
4. Block math is visually distinct from paragraphs and keeps its own block spacing.
5. Opening a Markdown File with valid inline or block math shows rendered math by default.
6. Clicking into or selecting a math expression reveals the editable LaTeX source for that expression.
7. Leaving the math expression returns it to rendered math when the source is valid.
8. Invalid LaTeX remains editable and shows a visible error state without dropping the original source.
9. Saving emits normal Markdown math syntax, preserving `$...$` for inline math and `$$...$$` for block math.
10. Reopening a saved file keeps the same math expressions and surrounding Markdown structure.
11. Copying selected editor text with normal copy should include readable text; future copy-as-Markdown behavior should include original math delimiters.
12. Markdown shortcuts, slash commands, links, lists, code, images, embeds, and file properties continue to behave as they do today around math.
13. Math delimiters inside fenced code blocks and inline code remain code text, not rendered math.
14. Plain currency-style text such as `$5` should not eagerly become a broken math expression.
15. Keyboard navigation can enter, edit, and leave math expressions without trapping focus.
16. Screen readers encounter math content with a useful text fallback based on the original LaTeX source.
17. The editor shows the same math behavior on desktop and web.
18. If the math renderer fails to load, the user still sees and can edit the original LaTeX source.

## UX validation

Use Hubble Desktop and the web editor with a Markdown File containing prose, inline math, block math, code, and lists:

1. Open the file and confirm inline and block math render while code-delimited math stays plain.
2. Click each math expression, edit the source, leave it, and confirm the rendered output updates.
3. Enter invalid LaTeX, confirm the source is still visible/editable and an error state appears.
4. Save, reopen, and confirm the Markdown source still contains the expected `$...$` and `$$...$$` syntax.
5. Navigate through math expressions with keyboard only and confirm focus does not get stuck.
