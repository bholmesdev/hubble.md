---
name: triage
description: Triage an incoming GitHub, Jira, Linear, or other issue-tracker issue against the current codebase and related issues, then return a structured decision with exactly one triage state. Use whenever the user asks to triage, classify, assess, prioritize, or label an issue for implementation readiness, especially when an issue URL, key, or number is supplied in the prompt.
---

# Triage

Assess the issue passed in the user's prompt and decide exactly one triage state:

- `Ready to implement`
- `Duplicate`
- `Needs discussion`

The goal is to route work honestly, not to make every issue appear actionable. Base the decision on evidence from the issue tracker, current checkout, and related issues.

This is a read-only analysis: inspect the issue and codebase but do not mutate the tracker. Return the structured decision described in step 5; the caller applies the label and comment.

## Workflow

### 1. Identify the issue and tracker

Extract the issue URL, key, or number from the prompt. Determine whether it belongs to GitHub Issues, Jira, Linear, or another tracker.

If the prompt does not identify one issue unambiguously, ask the user for the issue rather than guessing.

### 2. Fetch tracker context

Read the issue using the best available integration, in this order:

1. A relevant MCP server or native tracker tool
2. The tracker's authenticated CLI, such as `gh`
3. The tracker's API or web page

Fetch:

- Full issue title and description
- Comments and discussion
- Existing labels, status, assignee, project, and linked issues
- Attachments or screenshots when they materially affect understanding
- The tracker's available labels
- Related open and closed issues, including likely duplicates, dependencies, and nearby product work

Do not classify solely from the title. Do not expose credentials or secrets while fetching tracker data.

### 3. Inspect the current codebase

Confirm the current checkout is the relevant repository. Search the codebase for the affected feature, behavior, terminology, and likely implementation area.

Assess:

- Whether the described behavior exists today
- Likely files, services, and systems involved
- Whether the issue has a bounded implementation path
- Dependencies, migrations, platform differences, and testing requirements
- Existing abstractions that make the change cohesive or indicate it does not fit
- Whether related issues or active work change the recommendation

Prefer targeted searches and reads. This is triage, not implementation: do not edit product code.

### 4. Choose one state

Use the following rubric. When evidence sits between states, choose `Needs discussion`.

#### Ready to implement

Choose when:

- Desired behavior and success criteria are clear
- Scope is bounded and cohesive with the current product
- Likely implementation area is identifiable
- Complexity and risk are low enough that an implementer (human or agent) has a good chance of completing it correctly in one pass
- No unresolved product decision or major dependency blocks implementation

Small bugs with clear reproduction steps and straightforward improvements usually belong here.

#### Duplicate

Choose when another issue already tracks the same underlying behavior and scope. Require concrete tracker evidence; similar symptoms or overlapping implementation areas alone are not enough.

- Identify the canonical issue in the comment
- Prefer the issue with clearer acceptance criteria, more discussion, or active implementation
- If the canonical issue was closed as fixed but the behavior recurs, verify it is not a regression before choosing `Duplicate`
- Do not close or otherwise mutate the issue; the caller owns tracker changes

#### Needs discussion

Choose when neither implementation nor duplicate status is clear:

- Material product or technical decisions remain open
- Multiple valid designs, broad surface-area changes, or non-trivial dependencies make one-shot implementation risky
- The expected behavior, problem, scope, or reproduction is ambiguous
- Critical environment details, evidence, or acceptance criteria are missing
- The request may not fit the current product direction, conflicts with planned work, or a dependency makes it premature

### 5. Return the result

Pick the tracker label that matches the chosen state, preferring an existing label with the same meaning and the tracker's established naming and casing (for example `ready-to-implement`, `needs-discussion`, or `duplicate`).

Return a single raw JSON object as your final response — no prose and no markdown code fences:

```json
{
  "state": "Ready to implement | Duplicate | Needs discussion",
  "label": "exact tracker label matching the chosen state",
  "duplicate_of": "canonical issue URL or tracker key when state is Duplicate; otherwise null",
  "comment": "markdown body for the issue"
}
```

Write `comment` as reporter-facing markdown: a short lead sentence with the decision, then the evidence-based rationale, using a brief bullet list where it aids readability. For `Needs discussion`, end with the concrete questions and open decisions from step 4. For `Duplicate`, lead with `Duplicate of <duplicate_of>`, using the exact `duplicate_of` value from the result, and briefly state why it covers this report. Because `comment` is a JSON string, encode every line break as `\n` (a literal newline would make the JSON invalid).

## Guardrails

- Do not mutate the tracker: no comments, labels, status, assignment, or other changes. Return the structured result instead.
- Do not implement the issue during triage or edit product code.
- Do not classify an issue without checking both the tracker context and the current codebase.
- Do not put raw secrets, tokens, private environment variables, command output dumps, or internal reasoning in the result.
- Treat comments from maintainers and linked product/spec documents as stronger evidence than guesses from code alone.
