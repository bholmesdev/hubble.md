---
name: create-pr
description: Open a pull request for the current branch. Use whenever asked to make/create/open a PR.
metadata:
  internal: true
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

# Create a PR

Before opening the PR, run the `merge-risk` skill and mitigate the risks it finds, where possible without changing the PR's core functionality.

Run the `changelog` skill before or right after opening the PR.

Use `.github/pull_request_template.md` for the PR body. Skip preambles and keep prose brief.

Fill each section's **Verdict:** line with the verdict `merge-risk` gave its category after mitigation, emoji included: Verification → Verification, Impact → Impact, Rollback → Rollback cost (e.g. `**Verdict:** low ✅`).

For the Summary, pick the smallest view that makes the key point clear, and place it next to the short text it supports:

- pseudocode for logic or an algorithm
- a call tree for runtime control flow
- a component tree for UI structure, with the state and module boundaries that matter
- a shallow file tree for file responsibility or a broad refactor
- Mermaid for component interaction, control flow, or data flow
- a `diff` of any of the above when the point is what changes and the surrounding shape already exists
- the whole block when most of it is new, when omitted context would hide ownership or order, or when the reviewer needs a copyable target shape

Keep only the calls, files, props, states, and boundaries a reviewer needs. You may use one of these or several, but rarely all of them. Don't overwhelm the reviewer.

After opening the PR, tell the user if a stacked PR strategy could reduce blast radius or improve reviews.
