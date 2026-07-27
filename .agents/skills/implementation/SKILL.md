---
name: implementation
description: Implement a fix or feature from a GitHub, Jira, Linear, or other issue-tracker issue by fetching issue context, inspecting the current codebase, making code changes, validating them, opening a GitHub pull request, and reporting progress back to the original issue.
---

# Implementation

Implement the issue passed in the user's prompt and open a GitHub pull request with the fix or feature.

Expect the prompt to contain a link, key, or number for exactly one issue in an issue tracker. Use tracker context and the current checkout to understand the requested behavior before changing code.

## Workflow

### 1. Identify the issue and repository

Extract the issue URL, key, or number from the prompt. Determine whether it belongs to GitHub Issues, Jira, Linear, or another tracker.

Confirm the current checkout is the repository where the implementation should happen. If the prompt does not identify one issue unambiguously, ask for clarification before making changes.

### 2. Post an implementation-started status comment

For GitHub Issues, post a short status comment before doing implementation work so issue subscribers know an agent has started.

Use the authenticated `gh` CLI when available. Include:

- That automated implementation by a [Warp Factory agent](https://www.warp.dev/oz) has started.
- The issue identifier being implemented.
- A follow-along link to the Oz run or Oz session.

Use an Oz run URL or Oz session URL from the agent runtime, action output, environment, or logs. Do not use a GitHub Actions workflow URL as the follow-along link. If no Oz run or session link is available yet, say that the Oz follow-along link is not available yet rather than substituting another URL, and continue implementation.

Keep this comment concise.

### 3. Fetch tracker context

Use the best available integration in this order:

1. A relevant MCP server or native tracker tool
2. The tracker's authenticated CLI, such as `gh`
3. The tracker's API or web page

Fetch:

- Full issue title and description
- Comments and discussion
- Existing labels, status, assignee, project, and linked issues
- Attachments, screenshots, logs, reproduction steps, and acceptance criteria
- Related open issues, likely duplicates, dependencies, and nearby product work

Do not implement solely from the issue title. Do not expose credentials or secrets while fetching tracker data.

If tracker context is missing critical implementation details, post a concise blocker comment with the specific missing information and stop instead of guessing.

### 4. Inspect the current codebase

Search and read the codebase to understand the affected feature, behavior, terminology, and likely implementation area.

Assess:

- Whether the described behavior exists today
- Likely files, services, UI components, APIs, tests, and data flows involved
- Existing patterns and abstractions to follow
- Edge cases, migrations, platform differences, or compatibility risks
- Validation commands used by the repository

Post a brief progress comment if this investigation reveals a materially useful implementation area, for example: "I found the relevant editor state flow in `src/...` and am implementing the change there." Do not post internal reasoning, speculative details, secrets, or raw command output. Do not describe the implementation as complete until a pull request has been opened and you can include the PR URL.

### 5. Implement the change

Make the smallest cohesive change that satisfies the issue.

Follow existing code style and architecture. Update tests, fixtures, docs, or configuration when they are part of the expected behavior. Do not bundle unrelated refactors, formatting churn, dependency upgrades, or opportunistic cleanup into the PR.

If the issue turns out to be much larger or more ambiguous than expected, stop and comment with a concise recommendation rather than producing a risky partial implementation.

### 6. Validate the implementation

Run the most relevant validation commands for the repository. Prefer commands documented in README, package scripts, CI config, Makefiles, or existing workflow files.

At minimum, attempt:

- Targeted tests for the changed behavior, if available
- Linting or typechecking, if available
- A build or equivalent compile check, if appropriate

Then verify the change end-to-end with the repo's verification skills. Passing typechecks and unit tests is not sufficient for user-facing changes:

- For changes that affect the desktop app, follow `.agents/skills/test-desktop-app/SKILL.md`: run the app with CDP enabled, drive the changed flow in the real renderer (click controls, type, inspect DOM state), and confirm the issue's expected behavior visibly works. Capture a screenshot of the working flow when practical and include it in the PR.
- For changes that affect the web app, use the dev server with `?test=1` as described in `AGENTS.md` and drive the changed flow the same way.
- Before opening the PR, apply `.agents/skills/review-readiness/SKILL.md`.

If end-to-end verification is not possible in the current environment (for example the app cannot launch), say so explicitly in the PR with what was attempted; do not imply the flow was exercised.

If a validation command fails, investigate and fix failures caused by your changes. If failures appear unrelated or require external services, report them clearly in the PR and issue comment with enough detail for a reviewer to reproduce.

### 7. Create a branch and pull request

Create a descriptive branch for the implementation, such as `fix/issue-123-short-title` or `feature/issue-123-short-title`.

Commit only the intended changes. Use a clear commit message. When committing, include:

`Co-Authored-By: Warp Factory Agent <oz-agent@warp.dev>`

Push the branch and open a GitHub pull request against the repository's default branch using the authenticated `gh` CLI. Capture the PR URL returned by `gh pr create`; this URL is required before posting final success back to the issue.

The PR description should include:

- A direct link to the original issue
- Summary of the change
- Validation commands run and their results
- Known limitations, follow-up work, or validation gaps

Associate the PR with the issue in GitHub:

- If the implementation fully resolves the issue, include a closing keyword in the PR body, such as `Closes #123` or `Fixes #123`.
- If the implementation only partially addresses the issue, include a non-closing reference, such as `Related to #123`, and explain the remaining work.

After creating the PR, verify that you have a real PR URL. If `gh pr create` fails, do not post a success comment. Instead, fix the failure if possible, or post a blocker comment explaining that the implementation branch exists but PR creation failed.

### 8. Post the PR link and final status to the issue

Only after opening the PR, post a final comment on the original issue with:

- Link to the PR
- Brief summary of what was implemented
- Validation performed
- Any known limitations or reviewer notes

The final issue comment must include the PR URL. A comment that says implementation is complete or that a PR will be opened later is not acceptable.

If no PR was created, post why implementation did not proceed and what concrete next step is needed. Do not describe this as a successful implementation.

## Guardrails

- Do not implement without fetching tracker context and inspecting the codebase.
- Do not expose secrets, tokens, private environment variables, raw logs containing credentials, or internal reasoning in issue comments or PR descriptions.
- Do not close, assign, reprioritize, or relabel the issue unless explicitly requested.
- Do not overwrite unrelated labels or metadata.
- Do not make unrelated code changes.
- Do not claim validation passed if it was not run or failed.
- Do not post a final success comment unless a pull request has already been opened and the comment includes the PR URL.
- Post progress sparingly: always post the implementation-started comment, then post at most two additional progress comments before the final PR link unless blocked or explicitly asked for more updates.
