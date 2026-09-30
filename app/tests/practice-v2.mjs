// Deterministic regression tests for Practice & Assessment V2.
// Run: npm run test:eval
// Plain node asserts against the real mockCoach module (no framework,
// no network, no AI). Covers: full/partial coverage, anti-stuffing,
// alternative wording, length boundary, retry/remediation, completion,
// capability gate, and verdict independence from AI prose.

import {
  detectTemplate,
  diagnosticScore,
  evaluateCapability,
  evaluateCriteria,
  evaluatePractice,
  stageAssessment,
} from '../src/mockCoach.ts'

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

const FULL =
  'sumifs xlookup margin data totals and formulas answered cleanly'
const PARTIAL = 'sumifs margin data totals answered cleanly with formulas'
// Many repeated generic terms, but the lookup criterion is unmet.
const STUFFED =
  'sumifs sumifs sumifs margin margin margin data data data total total learn practice example goal result'
const ALT = 'sum if vlookup margin month data answered with formulas'
// Too short to satisfy the evidence floor.
const SHORT = 'sumifs xlookup m'

// 1. All required criteria satisfied -> satisfactory.
{
  const r = evaluatePractice('excel', 'excel-s2', FULL, 1)
  check('1 satisfactory when all criteria met', r.verdict === 'satisfactory')
}

// 2. One criterion missing -> not satisfactory.
{
  const missingLookup =
    'sumifs margin data totals answered cleanly with formulas here'
  const r = evaluatePractice('excel', 'excel-s2', missingLookup, 1)
  const unmet = r.verdict !== 'satisfactory'
  check('2 missing lookup criterion -> not satisfactory', unmet)
}

// 3. Stuffing generic/repeated terms cannot pass a substantive criterion.
{
  const r = evaluatePractice('excel', 'excel-s2', STUFFED, 1)
  check('3 stuffed response without lookup -> not satisfactory', r.verdict !== 'satisfactory')
  const dumpsKeywords = r.improvements.some((line) => /"[a-z]+"/.test(line))
  check('3 feedback names the unmet requirement, not keywords', !dumpsKeywords)
}

// 4. Accepted alternative wording passes.
{
  const r = evaluatePractice('excel', 'excel-s2', ALT, 1)
  check('4 alternative wording (sum if, vlookup) -> satisfactory', r.verdict === 'satisfactory')
}

// 5. Minimum-length boundary.
{
  const rShort = evaluatePractice('excel', 'excel-s2', SHORT, 1)
  check('5 short response -> retry', rShort.verdict === 'retry')
  const mentionsLength = rShort.improvements.some((line) =>
    line.includes('characters'),
  )
  check('5 short response explains the length rule', mentionsLength)
}

// 6. Retry after failure, then success on attempt 2.
{
  const first = evaluatePractice('excel', 'excel-s2', PARTIAL, 1)
  const second = evaluatePractice('excel', 'excel-s2', FULL, 2)
  check(
    '6 retry then satisfactory across attempts',
    first.verdict === 'retry' && second.verdict === 'satisfactory',
  )
}

// 7. Satisfactory completion signal.
{
  const r = evaluatePractice('excel', 'excel-s2', FULL, 1)
  check(
    '7 satisfactory carries continue action',
    r.verdict === 'satisfactory' && r.nextAction === 'Continue to the next stage.',
  )
}

// 8. Remediation after repeated failure, never trapped, no answer keys.
{
  const second = evaluatePractice('excel', 'excel-s2', PARTIAL, 2)
  const fifth = evaluatePractice('excel', 'excel-s2', PARTIAL, 5)
  check('8 second failure -> remedial', second.verdict === 'remedial')
  check('8 fifth failure -> still remedial (never trapped)', fifth.verdict === 'remedial')
  const leaksKeywords = second.improvements.some((line) =>
    /"[a-z]+"/.test(line),
  )
  check('8 remedial hints disclose no quoted keywords', !leaksKeywords)
  const retryAfter = evaluatePractice('excel', 'excel-s2', FULL, 6)
  check('8 practise-again path can still succeed', retryAfter.verdict === 'satisfactory')
}

// 9. Capability gate and evaluator unchanged.
{
  const good =
    'I cleaned the monthly sales dataset with validation, used SUMIFS and XLOOKUP for margin analysis, built a PivotTable and a responsive chart showing trends, then wrote up the findings with caveats and next steps for finance. ' +
    'I cleaned the monthly sales dataset with validation, used SUMIFS and XLOOKUP for margin analysis, built a PivotTable and a responsive chart showing trends, then wrote up the findings with caveats and next steps for finance.'
  const weak = 'I tried it and it was fine.'
  const capGood = evaluateCapability('excel', 'outcome', good)
  const capWeak = evaluateCapability('excel', 'outcome', weak)
  check(
    '9 capability good -> satisfactory with evidence',
    capGood.satisfactory === true && capGood.evidence.length > 0,
  )
  check('9 capability weak -> not satisfactory', capWeak.satisfactory === false)
}

// 10. Verdicts are deterministic inputs to (not outputs of) AI prose.
{
  const r = evaluatePractice('excel', 'excel-s2', FULL, 1)
  check(
    '10 verdict present without any AI involvement',
    r.verdict === 'satisfactory' &&
      Array.isArray(r.strengths) &&
      Array.isArray(r.improvements) &&
      typeof r.nextAction === 'string',
  )
}

// Every stage exposes exactly the criteria the evaluator checks.
{
  const byTemplate = {
    excel: ['excel-s1', 'excel-s2', 'excel-s3'],
    web: ['web-s1', 'web-s2', 'web-s3'],
    data: ['data-s1', 'data-s2', 'data-s3'],
    generic: ['gen-s1', 'gen-s2', 'gen-s3'],
  }
  let total = 0
  let allThree = true
  for (const [template, ids] of Object.entries(byTemplate)) {
    for (const stageId of ids) {
      const assessment = stageAssessment(template, stageId)
      total += assessment.criteria.length
      if (assessment.criteria.length !== 3) allThree = false
      if (evaluateCriteria(assessment.criteria, FULL).length !== 3) {
        allThree = false
      }
    }
  }
  check('every stage exposes 3 evaluable criteria', allThree && total === 36)
}

// Unknown stage ids fail safe (retry, never satisfactory).
{
  const r = evaluatePractice('excel', 'no-such-stage', FULL, 1)
  check('unknown stage -> retry, never satisfactory', r.verdict === 'retry')
}

// Diagnostic scoring untouched by the V2 change.
{
  const s = diagnosticScore('excel', [
    { questionId: 'excel-1', choiceId: 'b' },
    { questionId: 'excel-2', choiceId: 'c' },
  ])
  check(
    'diagnostic scoring unchanged',
    s.score === 3 && s.level === 'Developing' && detectTemplate('excel') === 'excel',
  )
}

if (failures > 0) {
  console.log(`EVAL-V2-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('EVAL-V2-ALL-PASS')
