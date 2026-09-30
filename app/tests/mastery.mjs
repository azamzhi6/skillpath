// Deterministic tests for Learner Model Milestone 1.
// Run: npm run test:mastery
// Covers the pure mastery-transition rules, row isolation, the remediation
// prioritization rule, and the attempts === passes + failures invariant.
// No database, no network, no AI.
import {
  initialMasteryRow,
  nextMasteryRow,
} from '../server/mastery.ts'
import { prioritizeRemediation } from '../src/mockCoach.ts'

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

function invariant(row) {
  return (
    row.attempts === row.passes + row.failures &&
    row.attempts >= 1 &&
    row.passes >= 0 &&
    row.failures >= 0 &&
    row.consecutiveFailures >= 0
  )
}

// First assessment.
{
  const fail = initialMasteryRow('excel', 'excel-s1', 'c1', false, 't0')
  check(
    'first fail -> developing',
    fail.attempts === 1 &&
      fail.passes === 0 &&
      fail.failures === 1 &&
      fail.consecutiveFailures === 1 &&
      fail.lastResult === 'fail' &&
      fail.masteryStatus === 'developing' &&
      invariant(fail),
  )
  const pass = initialMasteryRow('excel', 'excel-s1', 'c1', true, 't0')
  check(
    'first pass -> demonstrated',
    pass.attempts === 1 &&
      pass.passes === 1 &&
      pass.failures === 0 &&
      pass.consecutiveFailures === 0 &&
      pass.lastResult === 'pass' &&
      pass.masteryStatus === 'demonstrated' &&
      invariant(pass),
  )
}

// Repeated assessment in every direction.
{
  const developing = initialMasteryRow('excel', 's', 'c', false, 't0')
  const ff = nextMasteryRow(developing, false, 't1')
  check(
    'fail -> fail stays developing',
    ff.masteryStatus === 'developing' &&
      ff.consecutiveFailures === 2 &&
      ff.attempts === 2 &&
      invariant(ff),
  )
  const fp = nextMasteryRow(developing, true, 't1')
  check(
    'fail -> pass becomes demonstrated',
    fp.masteryStatus === 'demonstrated' &&
      fp.consecutiveFailures === 0 &&
      fp.passes === 1 &&
      invariant(fp),
  )
  const demonstrated = initialMasteryRow('excel', 's', 'c', true, 't0')
  const pp = nextMasteryRow(demonstrated, true, 't1')
  check(
    'pass -> pass stays demonstrated',
    pp.masteryStatus === 'demonstrated' && pp.passes === 2 && invariant(pp),
  )
  const pf = nextMasteryRow(demonstrated, false, 't1')
  check(
    'pass -> fail returns to developing',
    pf.masteryStatus === 'developing' &&
      pf.consecutiveFailures === 1 &&
      pf.failures === 1 &&
      invariant(pf),
  )
}

// Rows are independent across criteria, stages, and templates.
{
  const a = initialMasteryRow('excel', 'excel-s1', 'c1', false, 't0')
  const b = nextMasteryRow(
    initialMasteryRow('excel', 'excel-s1', 'c2', true, 't0'),
    false,
    't1',
  )
  const c = nextMasteryRow(
    initialMasteryRow('web', 'web-s1', 'c1', false, 't0'),
    false,
    't1',
  )
  check(
    'isolation across criteria/stages/templates',
    a.consecutiveFailures === 1 &&
      b.consecutiveFailures === 1 &&
      b.passes === 1 &&
      c.masteryStatus === 'developing' &&
      invariant(a) &&
      invariant(b) &&
      invariant(c),
  )
}

// Remediation prioritization: repeated failures first, else all unmet.
{
  const unmet = ['c1', 'c2']
  const withHistory = [
    { stageId: 's', criterionId: 'c1', consecutiveFailures: 1 },
    { stageId: 's', criterionId: 'c2', consecutiveFailures: 3 },
  ]
  check(
    'repeated failures prioritized',
    JSON.stringify(prioritizeRemediation(unmet, withHistory, 's')) ===
      JSON.stringify(['c2']),
  )
  const fresh = [
    { stageId: 's', criterionId: 'c1', consecutiveFailures: 1 },
    { stageId: 's', criterionId: 'c2', consecutiveFailures: 0 },
  ]
  check(
    'no repeats -> all unmet targeted',
    JSON.stringify(prioritizeRemediation(unmet, fresh, 's')) ===
      JSON.stringify(['c1', 'c2']),
  )
  check('empty unmet -> empty focus', prioritizeRemediation([], withHistory, 's').length === 0)
  const otherStage = [{ stageId: 'other', criterionId: 'c2', consecutiveFailures: 5 }]
  check(
    'other stages never leak into focus',
    JSON.stringify(prioritizeRemediation(unmet, otherStage, 's')) ===
      JSON.stringify(['c1', 'c2']),
  )
}

if (failures > 0) {
  console.log(`MASTERY-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('MASTERY-ALL-PASS')
