// PostgreSQL data-layer integration tests for the Netlify migration.
// Run: npm run test:db
// Uses pg-mem (in-memory Postgres) by default — no server required.
// Set TEST_DATABASE_URL to run the same suite against a real PostgreSQL
// (e.g. Neon) instead. Covers: schema creation, snapshot round-trip,
// submissions + mastery transitions, reset, and initDb idempotency.
import { newDb } from 'pg-mem'
import {
  clearAll,
  initDb,
  journeyExists,
  loadLearning,
  loadMastery,
  loadSnapshot,
  overridePoolForTests,
  saveSnapshot,
  saveSubmission,
} from '../server/db.ts'

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

if (process.env.TEST_DATABASE_URL) {
  // db.ts reads NETLIFY_DATABASE_URL/DATABASE_URL; forward the test
  // database without overriding a real configuration.
  if (!process.env.DATABASE_URL && !process.env.NETLIFY_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  }
  console.log('Using real PostgreSQL from TEST_DATABASE_URL')
} else {
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  overridePoolForTests(new Pool())
  console.log('Using pg-mem (no TEST_DATABASE_URL set)')
}

const BASE_SNAPSHOT = {
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
  stages: [],
  completedStageIds: [],
  parsedGoal: null,
}

const OUTCOMES = (metFlags) =>
  metFlags.map((met, i) => ({ criterionId: `c${i + 1}`, met }))

// Fresh schema creation + idempotent init.
await initDb()
await initDb()
check('initDb is idempotent', (await loadSnapshot()) === null)
check('no journey on fresh database', (await journeyExists()) === false)

// Snapshot round-trip with and without parsed goal.
await saveSnapshot({ ...BASE_SNAPSHOT })
check('journey exists after save', await journeyExists())
{
  const loaded = await loadSnapshot()
  check(
    'snapshot round-trip preserves goal',
    loaded !== null && loaded.goalText === BASE_SNAPSHOT.goalText,
  )
  check('snapshot without parsed goal reads null', loaded?.parsedGoal === null)
}
await saveSnapshot({
  ...BASE_SNAPSHOT,
  parsedGoal: { subject: 'S', desiredOutcome: 'D', timeframe: 'flexible' },
})
{
  const loaded = await loadSnapshot()
  check(
    'snapshot with parsed goal round-trips',
    loaded?.parsedGoal?.subject === 'S' &&
      loaded?.parsedGoal?.timeframe === 'flexible',
  )
}

// Submission + mastery transitions.
{
  const first = await saveSubmission(
    {
      stageId: 's1',
      kind: 'practice',
      response: 'r',
      verdict: 'retry',
      strengths: '[]',
      improvements: '[]',
      nextAction: 'x',
    },
    OUTCOMES([true, false]),
    'excel',
  )
  check('first submission assigns attempt 1', first.attempt === 1)
  let mastery = await loadMastery()
  const c1 = mastery.find((m) => m.criterionId === 'c1')
  const c2 = mastery.find((m) => m.criterionId === 'c2')
  check(
    'first pass -> demonstrated, first fail -> developing',
    c1?.masteryStatus === 'demonstrated' &&
      c1?.passes === 1 &&
      c2?.masteryStatus === 'developing' &&
      c2?.consecutiveFailures === 1,
  )
  await saveSubmission(
    {
      stageId: 's1',
      kind: 'practice',
      response: 'r2',
      verdict: 'retry',
      strengths: '[]',
      improvements: '[]',
      nextAction: 'x',
    },
    OUTCOMES([true, false]),
    'excel',
  )
  mastery = await loadMastery()
  const c2again = mastery.find((m) => m.criterionId === 'c2')
  check(
    'attempt increments and consecutive failures accumulate',
    c2again?.attempts === 2 &&
      c2again?.failures === 2 &&
      c2again?.consecutiveFailures === 2 &&
      c2again.attempts === c2again.passes + c2again.failures,
  )
  const block = await loadSnapshot()
  void block
  const learning = await loadLearning()
  check(
    'learning block carries submissions and mastery',
    learning.submissions.length === 2 && learning.mastery.length === 2,
  )
}

// Reset clears everything including mastery.
await clearAll()
{
  const learning = await loadLearning()
  check(
    'reset clears submissions and mastery',
    learning.submissions.length === 0 &&
      learning.mastery.length === 0 &&
      (await loadSnapshot()) === null &&
      (await journeyExists()) === false,
  )
}

if (failures > 0) {
  console.log(`DB-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('DB-ALL-PASS')
