# Triage Labels

Every open issue should carry **exactly one** triage-state label. Bug/feature templates pre-apply `needs-triage`. The scheduled `issue-pipeline` skill treats open issues with no triage-state label (blank issues, CLI/API creates, template misses) the same as `needs-triage`, and replaces it with a decision label.

| Label                | Meaning                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| `needs-triage`       | Maintainer or triage agent needs to evaluate this issue                             |
| `ready-to-implement` | Behavior and scope are clear; anyone (contributor or agent) can pick this up        |
| `duplicate`          | Another issue already tracks the same underlying behavior and scope                  |
| `needs-discussion`   | Open product or technical questions; discuss on the issue before implementing       |
| `wontfix`            | Will not be actioned (human-applied)                                                |

Use `ready-to-implement` when the issue is clearly outlined and implementation can start without further product decisions.

Use `duplicate` only when a canonical issue clearly covers the same behavior and scope. Link that issue in the triage comment. Do not use `needs-discussion` merely because parallel implementation would conflict.

Use `needs-discussion` when neither implementation nor duplicate status is clear due to ambiguity, open design decisions, or uncertain fit. The triage comment should leave concrete clarifying questions so the discussion can start immediately.

Other labels (`bug`, `enhancement`, priority, etc.) are orthogonal and may coexist with a triage-state label. Do not leave an open issue with only non-triage labels.

Older labels (`ready-for-spec`, `ready-for-agent`, `needs-info`, `wait-to-implement`) are retired from the triage flow; `ready-for-spec` was renamed to `needs-discussion` and `ready-for-agent` to `ready-to-implement`.
