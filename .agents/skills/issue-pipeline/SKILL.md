---
name: issue-pipeline
description: Pick the next untriaged GitHub issue, triage it, ask the maintainer pointed questions when it needs discussion, and otherwise implement, verify, review, and open a PR through the implement-issue workflow. Use when the scheduled issue run fires or when asked to work the next issue.
---

# Issue pipeline

One issue per run. This session owns every outward-facing step (labels, comments, push, PR). The `implement-issue` workflow (`.claude/workflows/implement-issue.js`) owns the mechanical implement → verify → review loop and only touches the local checkout.

Labels follow `docs/agents/triage-labels.md`; `gh` conventions follow `docs/agents/issue-tracker.md`.

## 1. Pick the issue

If the prompt names an issue, use it. Otherwise take the oldest open issue that has `needs-triage` or no triage-state label at all, and no open PR referencing it:

```bash
gh issue list --state open --limit 100 --json number,title,labels,createdAt \
  --jq '[.[] | select([.labels[].name] | (index("needs-triage") != null) or (any(. == "ready-to-implement" or . == "needs-discussion" or . == "duplicate" or . == "wontfix") | not))] | sort_by(.createdAt) | .[0]'
```

If nothing qualifies, say so in one line and end the run. Otherwise rename the session to `#<number> <title>`.

## 2. Triage

Run the `triage` skill on the issue. It returns `{state, label, duplicate_of, comment}` and mutates nothing. Then apply the result yourself, replacing any existing triage-state label:

```bash
gh issue edit <n> --remove-label needs-triage --add-label <label>
gh issue comment <n> --body-file <comment.md>
```

## 3. Route by state

### Duplicate

Apply the label and post the comment. Do not close the issue. End the run with a one-line summary.

### Needs discussion

1. Turn the open decisions into 2–4 pointed questions, the way you would with `AskUserQuestion` when a user brings a request: each one decision, with 2–4 concrete options and your recommendation first. Favor product and front-end design decisions and missing reproduction details over implementation trivia.
2. Post them on the issue as the triage comment (numbered, each with its options), so the reporter can answer there too.
3. Ask the same questions with `AskUserQuestion` and wait. This blocks the run until the maintainer answers.
4. When answered, post the answers on the issue as `Maintainer decisions:` with one line per question. If the answers make it ready, swap `needs-discussion` for `ready-to-implement` and continue to **Ready to implement**. If they make it `wontfix` or still unclear, apply that label, say so on the issue, and end the run.

### Ready to implement

1. Comment on the issue that an agent has started implementing it.
2. Make sure you are in a worktree of your own (enter one if not), then `git fetch origin main && git switch -c agent/issue-<n>-<short-slug> origin/main`.
3. Run the saved workflow `implement-issue` with args `{issue: <n>, branch: "<branch>", verificationDir: "<scratchpad>/issue-<n>"}`. Use the absolute scratchpad path so recordings stay out of the repo.

## 4. Act on the workflow result

The workflow returns `{status, summary, validation, verification, review}`.

- **`blocked`**: post the blocker on the issue, swap the label to `needs-discussion`, and go back to **Needs discussion** step 3 with the blocker as the question. Do not open a PR.
- **`verification-failed`** or **`review-unsettled`**: do not open a PR. Send the recordings to this thread with `SendUserFile`, list the failure or the unresolved findings (with the implementer's disputes), and ask with `AskUserQuestion` whether to open the PR anyway, retry with guidance, or stop.
- **`ready-for-pr`**: continue to step 5.

## 5. Open the PR

1. Send the recordings from `verification.recordings` to this thread with `SendUserFile` so they live in the session.
2. Publish a private verification Artifact for the issue: the steps from `verification.steps` with the recordings embedded. Upload the `.mp4` files as artifact assets rather than attaching them to GitHub. Follow the Artifact tool's design and capabilities skills.
3. Push the branch and open a regular, non-draft PR with the `create-pr` skill (PR template, `Closes #<n>`, changelog entry). In Testing, include the validation commands, the steps that were driven in the app, a `Verification:` link to the Artifact, and a line on review: rounds run, plus any disputed findings with the reason they were declined.
4. Add two sections after Testing, judged with the `merge-risk` skill's Impact and Rollback cost categories and verdict labels:

   ```markdown
   ## Impact
   **<small ✅ | medium 👀 | large ⚠️>**: <blast radius in one sentence>
   - <surfaces touched, e.g. layout shift, other consumers, mobile, and any sensitive area such as config, dependencies, or file I/O>

   ## Revertibility
   **Rollback cost: <low ✅ | medium 👀 | high ⚠️>**: <two-way or one-way door>
   - How to revert: <e.g. `git revert <merge commit>` alone, or the extra steps a revert needs: persisted settings or note-file formats to migrate back, released versions already carrying the change>
   ```
5. Comment on the issue with the PR link and a two-line summary.

## 6. Wrap up

End with the PR link, the verification Artifact link, and anything that was skipped or unverified. Never claim verification or review settled when the workflow did not report it.
