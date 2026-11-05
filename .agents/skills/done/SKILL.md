---
name: done
description: Use this skill when the human has decide we're done working on the feature, and we're ready to merge into main.
metadata:
  internal: true
---

Before committing, record what shipped: follow the `changelog` skill to add a user-facing entry under `## [Unreleased]` in `CHANGELOG.md`. Skip only if the work is internal-only (no user-visible effect).

Review remaining uncommitted code. If all changes are related and can fit into an atomic commit, create a single commit. If work should be broken into multiple atomic commits, do so and commit all.

If we're on a worktree, merge back into the main/master. Then, clean up the worktree.

If work on this feature was tied to a GitHub issue, close that issue as completed.

At the very end, push main to origin.
