---
name: review-cycle
description: Work through code-review feedback on an open PR until checks and review threads settle, after the user says the work is ready for their review. Do not use for a one-off PR review.
---

# Review cycle

Use this after the human decides a feature or PR is ready for their review.

1. Check for review comments sent via the code review agent on GitHub.
2. Fix actionable findings.
3. Resolve threads after verifying the fix. For feedback that does not apply, explain why; leave the thread open if a decision remains contested.
4. Wait for checks and any configured automated reviews of the new commit, then fetch the threads again. Repeat for new actionable findings.
5. Hand the PR to the human only when required checks have finished and no actionable review thread remains unresolved. Report the PR link, fixes, and validation. If a product decision or external failure blocks the cycle, state the concrete blocker without claiming the review is settled.

Do not broaden the PR or make speculative changes to satisfy a reviewer. If a reviewer repeatedly raises an invalid finding, explain the evidence once and surface the disagreement to the human instead of looping indefinitely.
