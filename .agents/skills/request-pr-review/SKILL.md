---
name: request-pr-review
description: Request an automated review of the current pull request, address valid feedback, and repeat until approval. Use after opening a PR and before handing it to a human reviewer.
---

# Request a PR review

Push the current changes. Use an existing `Review Pull Requests` review for the current HEAD, or trigger one with `gh workflow run review-pull-requests.yml -f pr_number=<number>` and wait for that SHA's review.

Address valid feedback, run relevant checks, commit, and push. Pushing does not request another review; trigger one manually and repeat until approved.

Do not accept feedback blindly. If the reviewer is wrong or the same concern repeats, explain the disagreement and stop for human judgment. Stop after three review rounds.
