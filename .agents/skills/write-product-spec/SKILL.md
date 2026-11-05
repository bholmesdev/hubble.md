---
name: write-product-spec
description: Write a PRODUCT.md spec for a significant Hubble user-facing feature, focused only on user experience and observable behavior. Use when the user asks for a product spec, UX spec, PRD, desired behavior doc, or wants feature behavior clarified before implementation.
metadata:
  internal: true
---

# write-product-spec

Write a `PRODUCT.md` spec for a significant Hubble feature.

## Overview

The product spec settles the product decisions and spells out the user flow. A maintainer should be able to scan it in under a minute and either agree or point at the exact bullet they disagree with. It is a decision record, not documentation: write the choices, not the reasoning that led to them.

Stay out of implementation. No internal types, state layout, data flow, module architecture, or file paths. Those belong in the companion `TECH.md` from `write-tech-spec`.

"User" means the consumer of the surface: the person using Hubble desktop or web, or the developer invoking `hubble` for CLI surfaces.

Write specs to `specs/<id>/PRODUCT.md`, where `<id>` is a GitHub issue id prefixed with `gh-` (for example `specs/gh-456/PRODUCT.md`) or a short kebab-case feature name. `specs/` should contain only id-named directories as direct children. Use the sibling `TECH.md` path for the same id.

Only create a GitHub issue when the user explicitly asks. This repo uses GitHub Issues on `bholmesdev/hubble.md` via `gh`; see `docs/agents/issue-tracker.md`.

## Before Writing

Gather only enough context to write observable behavior:

- The existing user journey and the desired one.
- Nearby Hubble screens, flows, and design-system primitives the experience should reuse. Do not invent a new visual system.
- Project vocabulary from `CONTEXT.md`: Workspace, Workspace Folder, Plain Folder, Loose File, Cloud Sync, Markdown File, Asset, Embed, Embed Bundle, Workspace Snapshot.

## Structure

1. **Summary** — 1-2 sentences: the feature and the outcome.
2. **Flows** — the core of the spec. For each user flow, spell it out step by step: where the user starts, what they do, what they see at each step. Group the decisions that shape each flow as short bullets directly under it: inputs and their results, error and empty states, cross-surface (desktop vs web) differences, and what stays unchanged. One bullet per decision; state the choice, not the options considered.
3. **Out of scope** — bullets for what this slice deliberately does not do, including anything from the original issue that was dropped and why in a few words.

Optional, only when they earn their lines:

- **Problem** — one short paragraph, only when motivation is not obvious.
- **Open questions** — prefer inline `**Open question:** ...` next to the affected bullet.

Do not include implementation, module breakdown, engineering validation, or success criteria. The E2E test plan lives in `TECH.md` and should derive directly from the Flows section here.

## Writing Guidance

- Every bullet is a testable, observable behavior: what the user does and what they see.
- Cover the happy path completely, then only the edge cases where the answer is not obvious: error, empty, offline, conflict, and cancellation states that a reviewer would otherwise have to guess.
- Name existing primitives the user experiences (dialog, toast, popover, menu item) rather than describing new UI from scratch.
- Note Workspace-state differences (Workspace Folder, Plain Folder, Loose File, synced) only when the behavior actually differs.
- Target 20-60 lines total. If a section restates another, collapse it. Long numbered invariant lists are a smell: fold them into the flow they belong to.

## Keep Current

Update `PRODUCT.md` in the same PR when shipped behavior changes. The checked-in spec should describe what ships.

## Related Skills

- `write-tech-spec`
- `to-issues`
- `grill-with-docs`
