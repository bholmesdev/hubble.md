---
name: write-tech-spec
description: Write a TECH.md spec for a significant Hubble feature after researching the monorepo architecture. Use when the user asks for a technical spec, implementation plan, architecture plan, or package/app/module breakdown tied to product behavior.
metadata:
  internal: true
---

# write-tech-spec

Write a `TECH.md` spec for a significant Hubble feature.

## Overview

The tech spec is the implementation approach as scannable bullets grounded in real code, plus the test plan. A reviewer should be able to scan it in under a minute and spot the risky decision. It is not a build log or a tutorial: every bullet either names a change to make or a decision a reviewer might push back on.

Prefer a sibling `PRODUCT.md` first (`write-product-spec`). Reference its flows instead of restating user-facing behavior.

Write specs to `specs/<id>/TECH.md`, matching the sibling product spec id. `specs/` should contain only id-named directories as direct children.

Only create a GitHub issue when the user explicitly asks. This repo uses GitHub Issues on `bholmesdev/hubble.md` via `gh`; see `docs/agents/issue-tracker.md`.

## When To Use

Use for changes that span multiple modules, affect shared packages, change sync/workspace behavior, or introduce new data flow. Skip for single-file UI fixes.

## Research Before Writing

Read the product spec, then inspect the actual code. Do not guess about architecture when the code can be read:

- `CONTEXT.md` for domain terms and relevant `docs/adr/*` for constraints.
- The affected source under `apps/desktop`, `apps/www`, `packages/editor`, `packages/ui`, `packages/sync`, `packages/sync-backend`, `packages/convex-client`, `packages/cli`.
- Existing helpers and primitives that already do part of the job. Naming an existing unused helper beats proposing a new one.

## Structure

1. **Approach** — the core of the spec. Bullets stating what changes where, each grounded in real code: `New shared helper classifyHref(href) used in three places: ...`, `No parser/serializer changes; links round-trip as-is`, `Reuse normalizePath from apps/desktop/src/lib/filePath.ts (exists but unused here)`. Group by concern (renderer, main process, shared package) when the change spans layers. Explicitly call out what does NOT change when a reviewer would expect it to. State a tradeoff in one line only where more than one approach is plausible.
2. **E2E test plan** — required. Derive it from the `PRODUCT.md` flows:
   - Desktop: exact flows to drive in the running app per `.agents/skills/test-desktop-app/SKILL.md` — the Workspace state to open, the actions to perform, and the visible result to confirm. Name screens and controls, not "manually test the UI".
   - Web: the same flows via the dev server with `?test=1` when the behavior is cross-surface (requires `VITE_TEST_CONVEX_URL` and `VITE_TEST_WORKSPACE_ID` in `apps/www/.env.local`).
   - Unit/integration tests worth writing, named by module.
   - Commands: `pnpm check` for iteration, `pnpm build:desktop` for final confidence.

Optional, only when they earn their lines:

- **Risks** — real regressions, data loss, or sync hazards, one bullet each with the mitigation.
- **Diagram** — Mermaid only when it explains data flow faster than prose.
- **Follow-ups** — deferred slices.

Do not include boilerplate sections: no affected-package inventories, module-architecture essays, step-by-step build ordering, or parallelization plans. If a package matters, it shows up naturally in the Approach bullets' file paths.

## Writing Guidance

- Ground every bullet in code you read: name files, functions, and existing patterns. Prefer local paths with line numbers; use commit-pinned GitHub links only when the spec will be read outside a checkout.
- Use project vocabulary from `CONTEXT.md`.
- Reuse existing design-system primitives and nearby patterns before proposing new ones.
- Use logical CSS spacing props in frontend plans: `margin/padding` inline/block/start/end, not physical left/right/top/bottom.
- Target 30-80 lines total. If a bullet doesn't change what the implementer types or what the reviewer checks, cut it.

## Keep Current

Update `TECH.md` in the same PR when the approach, risks, or test plan changes. The checked-in spec should describe what ships.

## Related Skills

- `write-product-spec`
- `to-issues`
- `grill-with-docs`
