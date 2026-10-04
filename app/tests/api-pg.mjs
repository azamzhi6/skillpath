// API contract tests against pg-mem (no real Postgres needed).
// Exercises the real Express app (via serverless-http, same as the Netlify
// Function wrapper) through health/state/submissions/reset.
import { newDb } from 'pg-mem'
import serverless from 'serverless-http'

const mem = newDb()
const { Pool } = mem.adapters.createPg()

const { overridePoolForTests } = await import('../server/db.ts')
overridePoolForTests(new Pool())

const { default: app } = await import('../server/index.ts')
const handler = serverless(app)

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

function event(method, path, body) {
  return {
    httpMethod: method,
    path,
    headers: { 'Content-Type': 'application/json' },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
  }
}

async function call(method, path, body) {
  const res = await handler(event(method, path, body))
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    // leave null
  }
  return { status: res.statusCode, json }
}

const SNAPSHOT = {
  goalText: 'I want to learn Excel for financial analysis',
  template: 'excel',
  experience: 'Tried it before',
  hoursPerWeek: '4 hours',
  answers: [{ questionId: 'excel-1', choiceId: 'b' }],
  score: 1,
  level: 'Starting out',
  pathTitle: 'T',
  pathOutcome: 'O',
  pathLevel: 'L',
  stages: [
    {
      id: 'excel-s1',
      title: 'S1',
      criteria: [{ id: 'excel-s1-structure' }, { id: 'excel-s1-other' }],
    },
  ],
  completedStageIds: [],
  parsedGoal: null,
}

{
  const health = await call('GET', '/api/health')
  check('health 200', health.status === 200 && health.json?.ok === true)
}

{
  const put = await call('PUT', '/api/state', { state: SNAPSHOT })
  check('PUT snapshot 200', put.status === 200)
  const got = await call('GET', '/api/state')
  check(
    'GET round-trips goal',
    got.status === 200 && got.json?.state?.goalText === SNAPSHOT.goalText,
  )
}

{
  const bad = await call('PUT', '/api/state', {
    state: { ...SNAPSHOT, goalText: 'ab' },
  })
  check('invalid snapshot rejected', bad.status === 400)
}

let firstAttempt = 0
{
  const sub = await call('POST', '/api/submissions', {
    stageId: 'excel-s1',
    kind: 'practice',
    response: 'I formatted the table and checked validation.',
    verdict: 'retry',
    strengths: '["a"]',
    improvements: '["b"]',
    nextAction: 'Try again.',
    criteria: [
      { criterionId: 'excel-s1-structure', met: true },
      { criterionId: 'excel-s1-other', met: false },
    ],
    template: 'excel',
  })
  firstAttempt = sub.json?.submission?.attempt ?? 0
  const mastery = sub.json?.mastery ?? []
  check('submission persists with mastery', sub.status === 200 && firstAttempt === 1 && mastery.length === 2)
  const failed = mastery.find((m) => m.criterionId === 'excel-s1-other')
  check(
    'mastery reflects pass and fail',
    failed?.consecutiveFailures === 1 && failed?.masteryStatus === 'developing',
  )
}

{
  const dup = await call('POST', '/api/submissions', {
    stageId: 'excel-s1',
    kind: 'practice',
    response: 'x',
    verdict: 'retry',
    strengths: '["a"]',
    improvements: '["b"]',
    nextAction: 'Try again.',
    criteria: [{ criterionId: 'bogus-id', met: true }],
    template: 'excel',
  })
  check('unknown criterion id rejected', dup.status === 400)
}

{
  const reset = await call('DELETE', '/api/state')
  const after = await call('GET', '/api/state')
  check(
    'reset clears journey and learning',
    reset.status === 200 &&
      after.json?.state === null &&
      (after.json?.learning?.submissions ?? [1]).length === 0 &&
      (after.json?.learning?.mastery ?? [1]).length === 0,
  )
}

if (failures > 0) {
  console.log(`API-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('API-ALL-PASS')
