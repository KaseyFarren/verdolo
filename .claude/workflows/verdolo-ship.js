export const meta = {
  name: 'verdolo-ship',
  description: 'Code a change (or verify pending changes), then have separate security and testing agents check it before you push',
  phases: [
    { title: 'Code' },
    { title: 'Security Review' },
    { title: 'Test' },
  ],
}

const MAX_ROUNDS = 2

const SECURITY_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          summary: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['severity', 'summary'],
      },
    },
    overall: { type: 'string' },
  },
  required: ['findings', 'overall'],
}

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    summary: { type: 'string' },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          repro: { type: 'string' },
        },
        required: ['description'],
      },
    },
  },
  required: ['passed', 'summary'],
}

const task = typeof args === 'string' ? args : args && args.task
const repo = '~/verdolo'

const CODER_CONTEXT = `You work in the Verdolo repo (${repo}), a Next.js + Supabase app. Follow existing conventions: guard clauses over nested if-blocks, no em dashes anywhere in code or copy, TypeScript throughout. Do NOT commit or push - leave changes uncommitted in the working tree. Do NOT even run 'git add', just edit files.`

const SECURITY_CONTEXT = `You are a security reviewer for the Verdolo repo (${repo}), a multi-tenant Next.js + Supabase app. Review the UNCOMMITTED changes only (run 'git status' and 'git diff' - if there is nothing uncommitted, say so and return an empty findings list). This app has a known history of these exact bug classes, so check for them specifically:
- Missing or wrong Row Level Security (RLS) policies on new/changed Supabase tables or columns
- Service-role Supabase client used somewhere it shouldn't be (bypasses RLS) or leaking into client-side code
- New SECURITY DEFINER Postgres functions without a locked search_path
- TOCTOU races on any credit/quota/counter consumption
- Raw Supabase/Postgres/Stripe error text reaching the client instead of going through the apiError() helper
- Missing rate limiting on new API routes, especially AI or auth-adjacent ones
- Auth/authorization checks missing on new API routes or Server Actions (org membership, role checks)
- Secrets or service keys hardcoded or logged
- XSS via unescaped user content, SQL injection via string-built queries
Rate each finding critical/high/medium/low. Be concrete - name the file and, if you can, the line.`

const TEST_CONTEXT = `You are the tester for the Verdolo repo (${repo}). Verify the UNCOMMITTED changes actually work. Steps:
1. Run 'npm run lint' and 'npx tsc --noEmit'. Report any errors.
2. Run 'git diff --stat' to see what changed, then pick the matching Playwright spec(s) under tests/e2e/ (e.g. tasks.spec.ts for Tasks changes, revenue.spec.ts for billing/revenue, etc). Run them with 'npx playwright test <file>' - .env.test already has working test credentials and the dev server auto-starts via the webServer config (reuses one if already running).
3. If the change isn't covered by any existing spec, exercise the flow directly: start 'npm run dev' if nothing is running, and use available browser tools to click through the actual flow and confirm it works, rather than only describing what you'd check.
Report pass/fail with concrete failure descriptions and repro steps for anything broken.`

phase('Code')
let coder
if (task) {
  coder = await agent(
    `${CODER_CONTEXT}\n\nImplement this change: ${task}\n\nWhen done, run 'git diff --stat' and summarize what you changed, why, and any assumptions you made.`,
    { label: 'coder', phase: 'Code' }
  )
} else {
  coder = 'No task given - reviewing whatever is currently uncommitted in the working tree.'
  log('No task provided - skipping the Code phase and reviewing the existing uncommitted diff.')
}

let security, test
for (let round = 1; round <= MAX_ROUNDS; round++) {
  const [secResult, testResult] = await parallel([
    () => agent(SECURITY_CONTEXT, { label: `security-round${round}`, phase: 'Security Review', schema: SECURITY_SCHEMA }),
    () => agent(TEST_CONTEXT, { label: `test-round${round}`, phase: 'Test', schema: TEST_SCHEMA }),
  ])
  security = secResult
  test = testResult

  const blocking = (security && security.findings ? security.findings : []).filter(
    f => f.severity === 'critical' || f.severity === 'high'
  )
  const clean = blocking.length === 0 && test && test.passed

  if (clean) {
    log(`Round ${round}: clean - no blocking security findings, tests passed.`)
    break
  }

  log(`Round ${round}: ${blocking.length} blocking security finding(s), tests ${test && test.passed ? 'passed' : 'failed'}.`)

  if (round === MAX_ROUNDS) {
    log('Max fix rounds reached - reporting as-is instead of looping further.')
    break
  }

  phase('Code')
  const failureText = (test && test.failures && test.failures.length)
    ? test.failures.map(f => `- ${f.description}${f.repro ? ' (repro: ' + f.repro + ')' : ''}`).join('\n')
    : (test && test.passed ? 'none' : (test && test.summary) || 'unspecified failure')
  const findingsText = blocking.length
    ? blocking.map(f => `- [${f.severity}] ${f.file || ''}: ${f.summary}${f.recommendation ? ' - ' + f.recommendation : ''}`).join('\n')
    : 'none'
  const fixPrompt = `${CODER_CONTEXT}\n\nFix the following issues in the uncommitted changes:\n\nSecurity findings (blocking):\n${findingsText}\n\nTest failures:\n${failureText}\n\nAfter fixing, summarize what you changed.`
  coder = await agent(fixPrompt, { label: `coder-fix-round${round}`, phase: 'Code' })
}

const blockingFinal = (security && security.findings ? security.findings : []).filter(
  f => f.severity === 'critical' || f.severity === 'high'
)

return {
  task: task || null,
  coderSummary: coder,
  security,
  test,
  resolved: blockingFinal.length === 0 && !!(test && test.passed),
}
