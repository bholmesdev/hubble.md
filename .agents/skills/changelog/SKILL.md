---
name: changelog
description: Add a user-facing entry to CHANGELOG.md for work that just landed. Use when wrapping up a feature/fix, or when asked to record what changed. Called standalone or from the `done` skill.
---

# Changelog

Record what shipped as it lands. Do not scrape commits at release time, write
the entry now while the change is fresh.

## How

1. Open root `CHANGELOG.md`.
2. Add one bullet under `## [Unreleased]`, in the right subhead:
   - `Added` — new features the user can see/use.
   - `Changed` — behavior changes to existing features.
   - `Fixed` — bug fixes.
3. Write it for a user reading release notes, not as a commit message:
   - One line, present tense.
   - Describe the effect, not the implementation or file paths.
   - Skip internal-only churn (refactors, deps, CI, tests) unless it changes
     what the user experiences.
4. Link the PR for every entry (not the issue).
5. Credit the contributor. Every entry from someone other than `bholmesdev`
   gets a thank you, including when you are that contributor writing your own
   entry.

   Find the handle:
   - PR already open: `gh pr view --json author --jq .author.login`.
   - No PR yet: `gh api user --jq .login`, the account that will open it.

   Then, unless the handle is `bholmesdev`, put one of these before the link:
   - `Thanks [@handle](https://github.com/handle)!` for their own work.
   - `Thanks [@handle](https://github.com/handle) for the suggestion!` when
     `bholmesdev` landed someone else's issue.

Create a subhead only if it has at least one entry. Leave the empty scaffold
subheads as-is for the next entry.

## Example

```markdown
## [Unreleased]

### Added
- First-run onboarding with an HTML Apps callout. [#123](https://github.com/bholmesdev/hubble.md/pull/123)
- View and run HTML apps inside the editor. Thanks [@contributor](https://github.com/contributor)! [#124](https://github.com/bholmesdev/hubble.md/pull/124)

### Fixed
- Slash menu no longer hides behind the toolbar. Thanks [@contributor](https://github.com/contributor) for the suggestion! [#126](https://github.com/bholmesdev/hubble.md/pull/126)
```

Entries stay under `Unreleased` until `/release` promotes them to a version
heading. See `.agents/skills/release`.
