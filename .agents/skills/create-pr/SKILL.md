---
name: create-pr
description: Open a pull request for the current branch. Use whenever asked to make/create/open a PR.
---

# Create a PR

Before opening the PR, suggest running the `merge-risk` skill and mitigating the risks it finds, where possible without changing the PR's core functionality.

Run the `changelog` skill before or right after opening the PR.

Use `.github/pull_request_template.md` for the PR body. Write the Summary the way the `pr` skill describes.

After opening the PR, tell the user if a stacked PR strategy could reduce blast radius or improve reviews.
