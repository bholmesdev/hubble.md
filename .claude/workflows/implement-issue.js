export const meta = {
  name: 'implement-issue',
  description: 'Implement a ready-to-implement GitHub issue, verify it in the desktop app, and iterate on blocking review findings',
  whenToUse: 'Called by the issue-pipeline skill with {issue, branch, verificationDir} after triage marks an issue ready-to-implement',
  phases: [
    { title: 'Implement', detail: 'one agent implements the issue on the current branch' },
    { title: 'Verify', detail: 'drive the real desktop app and record the flow' },
    { title: 'Review', detail: 'fresh reviewers raise blocking findings; implementer fixes or disputes' },
    { title: 'Re-verify', detail: 'record again if review changed the code' },
  ],
}

// The scheduled issue-pipeline session owns everything outward-facing (labels,
// comments, push, PR). Agents here only change the local checkout and commit.

const { issue, branch, verificationDir } = args ?? {}
if (!issue || !branch || !verificationDir) {
  throw new Error('implement-issue needs args {issue, branch, verificationDir}')
}

const MAX_VERIFY_FIXES = 2
const MAX_REVIEW_ROUNDS = 3

const LOCAL_ONLY = `Work only in the current checkout, on branch \`${branch}\`. Do not push, open a PR, comment on or relabel the issue, or edit CHANGELOG.md; the calling session does those. Commit your changes to \`${branch}\` with a clear message.`

const IMPLEMENT_SCHEMA = {
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { type: 'string', enum: ['implemented', 'blocked'] },
    summary: { type: 'string', description: 'What changed and why, for the PR description' },
    blocker: { type: 'string', description: 'When blocked: the concrete missing decision or failure' },
    validation: { type: 'array', items: { type: 'string' }, description: 'Commands run and their result' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['passed', 'steps', 'recordings'],
  properties: {
    passed: { type: 'boolean' },
    steps: { type: 'array', items: { type: 'string' }, description: 'What was driven in the app and what was observed' },
    recordings: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of .mp4 recordings and screenshots' },
    failure: { type: 'string', description: 'When not passed: what broke, with the observed vs expected behavior' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['blocking'],
  properties: {
    blocking: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'file', 'problem', 'scenario'],
        properties: {
          id: { type: 'string', description: 'Short stable slug, e.g. "null-tab-on-close"' },
          file: { type: 'string' },
          line: { type: 'number' },
          problem: { type: 'string' },
          scenario: { type: 'string', description: 'Concrete input or state that produces the wrong behavior' },
        },
      },
    },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['fixed', 'disputed'],
  properties: {
    fixed: { type: 'array', items: { type: 'string' }, description: 'Finding ids fixed and committed' },
    disputed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string', description: 'Evidence the finding is wrong or not blocking' } },
      },
    },
  },
}

function verifyPrompt(attempt) {
  return `Verify GitHub issue #${issue} end-to-end in the real Hubble desktop app. Read it with \`gh issue view ${issue} --comments\` and the change with \`git diff main...HEAD\`.

Follow the test-desktop-app skill. Drive the flow the issue describes in the real renderer and confirm the expected behavior visibly works, including the edge cases the issue mentions.

Record the flow: over CDP, call Page.startScreencast, save each frame to a numbered JPEG, and when done stitch them with \`ffmpeg -framerate 10 -pattern_type glob -i '<dir>/*.jpg' -pix_fmt yuv420p <out>.mp4\`. Save recordings and a final screenshot under \`${verificationDir}/attempt-${attempt}/\` (create it). Stop the dev server when done and confirm no \`Hubble Dev\` process remains.

Do not change product code. If the behavior is wrong, report passed: false with what you observed.`
}

phase('Implement')
const impl = await agent(
  `Implement GitHub issue #${issue} in this repository. Follow the implementation skill for fetching context, inspecting code, making the smallest cohesive change, and running validation (\`pnpm check\`, desktop tsc, \`pnpm check:react-compiler\` after React changes, targeted tests). Skip its tracker comments, branch creation, and PR steps. Apply the simplify skill before finishing.

${LOCAL_ONLY}

If the issue turns out to need a product decision or is much larger than it looked, stop and return status "blocked" with the specific question instead of guessing.`,
  { label: `implement #${issue}`, schema: IMPLEMENT_SCHEMA },
)

if (!impl || impl.status === 'blocked') {
  return { status: 'blocked', blocker: impl?.blocker ?? 'Implementation agent failed', summary: impl?.summary ?? '' }
}

phase('Verify')
let verification = null
for (let attempt = 1; attempt <= MAX_VERIFY_FIXES + 1; attempt++) {
  verification = await agent(verifyPrompt(attempt), { label: `verify #${issue} (${attempt})`, phase: 'Verify', schema: VERIFY_SCHEMA })
  if (verification?.passed) break
  if (attempt > MAX_VERIFY_FIXES) break
  log(`Verification attempt ${attempt} failed; sending back to the implementer`)
  await agent(
    `End-to-end verification of GitHub issue #${issue} failed in the real desktop app:

${verification?.failure ?? 'The verification agent did not return a result.'}

Steps it ran:
${(verification?.steps ?? []).map((s) => `- ${s}`).join('\n')}

Fix the implementation so this flow works, rerun validation, and commit. ${LOCAL_ONLY}`,
    { label: `fix verification #${issue} (${attempt})`, phase: 'Verify' },
  )
}

if (!verification?.passed) {
  return { status: 'verification-failed', summary: impl.summary, validation: impl.validation, verification }
}

phase('Review')
// Findings the implementer disputed, so later reviewers weigh the evidence instead of re-raising them blindly.
const disputes = []
const raisedBefore = new Set()
let unresolved = []
let reviewChangedCode = false
let rounds = 0

for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
  rounds = round
  const priorDisputes = disputes.length
    ? `\n\nThe implementer disputed these earlier findings. Re-raise one only if you have concrete evidence the dispute is wrong:\n${disputes.map((d) => `- ${d.id}: ${d.reason}`).join('\n')}`
    : ''
  const review = await agent(
    `Adversarially review the change on branch \`${branch}\` (\`git diff main...HEAD\`) that implements GitHub issue #${issue} (\`gh issue view ${issue}\`). Use the code-review skill at high effort on that diff; if it is unavailable, review the diff yourself with the same bar.

Report only blocking findings: incorrect behavior, crashes, data loss, regressions, a missed requirement from the issue, or a violation of a rule in AGENTS.md (e.g. a missing changelog entry is NOT blocking here; the caller adds it). Each needs a concrete failing scenario. Drop nits, style, naming, and speculative cleanups. An empty list is the expected outcome for a sound change. Do not edit files.${priorDisputes}`,
    { label: `review #${issue} (round ${round})`, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' },
  )
  const blocking = review?.blocking ?? []
  log(`Review round ${round}: ${blocking.length} blocking finding(s)`)
  if (blocking.length === 0) {
    unresolved = []
    break
  }

  // A finding raised again after the implementer already handled it means the two disagree; stop and surface it.
  const repeats = blocking.filter((f) => raisedBefore.has(f.id))
  if (repeats.length > 0) {
    unresolved = repeats
    break
  }
  for (const f of blocking) raisedBefore.add(f.id)

  const fix = await agent(
    `A reviewer raised these blocking findings on your implementation of GitHub issue #${issue}:

${blocking.map((f) => `- [${f.id}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.problem}\n  Scenario: ${f.scenario}`).join('\n')}

For each finding, check it against the code. Fix the real ones, rerun validation, and commit. Dispute any that are wrong or not actually blocking, with evidence. Do not broaden the change. ${LOCAL_ONLY}`,
    { label: `address review #${issue} (round ${round})`, phase: 'Review', schema: FIX_SCHEMA },
  )
  if (fix?.fixed?.length) reviewChangedCode = true
  disputes.push(...(fix?.disputed ?? []))
  unresolved = blocking.filter((f) => !fix?.fixed?.includes(f.id))
}

if (reviewChangedCode) {
  phase('Re-verify')
  verification = await agent(verifyPrompt('final'), { label: `re-verify #${issue}`, phase: 'Re-verify', schema: VERIFY_SCHEMA })
  if (!verification?.passed) {
    return { status: 'verification-failed', summary: impl.summary, validation: impl.validation, verification, review: { rounds, unresolved, disputes } }
  }
}

return {
  status: unresolved.length ? 'review-unsettled' : 'ready-for-pr',
  summary: impl.summary,
  validation: impl.validation,
  verification,
  review: { rounds, unresolved, disputes },
}
