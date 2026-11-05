---
name: create-pr
description: Open a pull request for the current branch. Use whenever asked to make/create/open a PR.
---

# Create a PR

Before opening the PR, run the `merge-risk` skill and mitigate the risks it finds, where possible without changing the PR's core functionality.

Run the `changelog` skill before or right after opening the PR.

Use `.github/pull_request_template.md` for the PR body. Skip preambles and keep prose brief.

For the Summary, pick the smallest view that makes the key point clear, and place it next to the short text it supports:

- pseudocode for logic or an algorithm
- a call tree for runtime control flow
- a component tree for UI structure, with the state and module boundaries that matter
- a shallow file tree for file responsibility or a broad refactor
- Mermaid for component interaction or data flow
- a `diff` of any of the above when the point is what changes and the surrounding shape already exists

Keep only the calls, files, props, and states a reviewer needs. One visual is usually enough.

After opening the PR, tell the user if a stacked PR strategy could reduce blast radius or improve reviews.
