---
name: writing-tests
description: Use when writing or reviewing tests, or deciding whether a change needs one.
---

# Writing tests

Shape coverage like Kent C. Dodds' testing trophy: static checks at the base, a thin layer of unit tests, most confidence from integration tests, and the smallest budget for end-to-end tests.

## When a test is warranted

A test is warranted when it catches a plausible regression that nothing else would. Prove it before keeping the test:

1. Revert the source change, keeping the test. Run it and confirm it goes red.
2. Read the failure. It should fail on the behavior in the test's name, not on a changed signature, a missing helper, or a setup error.
3. If the change touches several behaviors, revert each one separately and confirm a test goes red for each.

A test that stays green on revert, or goes red for the wrong reason, is coupled to the code's shape instead of its behavior. Rewrite its assertion or delete it.

Good candidates: bug fixes, tricky UI behavior (focus handoff, keyboard flows, races between async work and navigation), and edge cases in pure logic (Markdown parsing and serialization, paths, rename rules). Glue code, prop pass-through, and variations of an already-covered behavior get no test of their own.

## Pick the layer

| Layer | Here | Use for |
|---|---|---|
| Static | Biome, tsc, `pnpm check:react-compiler` | Anything a type or lint rule can catch |
| Unit | Vitest on pure functions | Parsers, serializers, path logic |
| Integration (default) | Vitest + happy-dom, rendering real components against real stores | UI behavior, store actions |
| End-to-end | Playwright driving Electron | A few core flows where a break loses users' work: opening, editing, and saving notes; creating and renaming files |

happy-dom has no layout. Verify sticky, scroll, overflow, and positioning by hand with the `test-desktop-app` skill and put a screenshot in the PR, rather than asserting DOM structure. Most changes get no end-to-end test.

## Mock at the seam

Fake only what crosses a process or time boundary: `desktopApi`/IPC, the filesystem, the network, timers, `requestAnimationFrame`. Keep stores, components, and the editor real. `apps/desktop/src/store/actions.test.ts` shows the pattern: a fake desktop API with the real store behind it.

If a test needs to mock internal modules to reach the behavior, move it one layer up so those modules run for real.

