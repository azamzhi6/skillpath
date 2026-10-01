// Deterministic tests for Capability V2 (template-specific briefs).
// Run: npm run test:capability
// Plain node asserts against the real mockCoach module (no framework,
// no network, no AI). Covers: briefs per template, all-met satisfactory,
// one-unmet failure naming the requirement (never keywords), anti-stuffing,
// length boundary, alternative wording, and the unchanged gate/evidence.
import {
  capabilityBrief,
  detectTemplate,
  evaluateCapability,
} from '../src/mockCoach.ts'

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

const OUTCOME = 'Clean, analyse and present a monthly sales dataset.'

// A. Every template has a distinct brief with criteria.
{
  const briefs = ['excel', 'web', 'data', 'generic'].map((t) =>
    capabilityBrief(t),
  )
  const allHaveCriteria = briefs.every(
    (b) =>
      typeof b.title === 'string' &&
      typeof b.instructions === 'string' &&
      Array.isArray(b.criteria) &&
      b.criteria.length >= 3 &&
      b.criteria.every((c) => typeof c.label === 'string' && Array.isArray(c.groups)),
  )
  check('A templates have briefs with 3+ criteria', allHaveCriteria)
  const ids = briefs.map((b) => b.criteria.map((c) => c.id).join(','))
  const distinct =
    new Set(ids).size === 4 && !ids[0].includes('web-cap');
  check('A briefs are template-specific, not one generic list', distinct)
  check('A brief minLength matches evaluator floor', briefs.every((b) => b.minLength === 60))
}

// B. All criteria satisfied -> satisfactory + evidence excerpt.
const EXCEL_GOOD =
  'I built the monthly sales analysis with SUMIFS for conditional totals and XLOOKUP lookups. ' +
  'The summary table and chart show margins by month with total results. ' +
  'This means the north region is the most profitable because repeat orders drive volume. ' +
  'One caveat: I assumed returns stay flat, so I verified a sample and will check again next month.'
{
  const r = evaluateCapability('excel', OUTCOME, EXCEL_GOOD)
  check(
    'B all capability requirements met -> satisfactory',
    r.satisfactory === true &&
      r.result === 'satisfactory' &&
      r.capability === OUTCOME &&
      r.evidence.length > 0,
  )
}

// C. One requirement missing -> fail, feedback names the label.
{
  const missingMeaning =
    'I used SUMIFS and XLOOKUP and made a chart table of totals and results with a caveat about limits I checked and verified.'
  const r = evaluateCapability('excel', OUTCOME, missingMeaning)
  const namesRequirement = r.improvements.some((line) =>
    line.includes('Explain what the result means'),
  )
  const leaksKeywords = r.improvements.some((line) => /"[a-z ]+"/.test(line))
  check('C missing interpretation -> not satisfactory', r.satisfactory === false)
  check('C feedback names the requirement label', namesRequirement)
  check('C feedback discloses no quoted keywords', !leaksKeywords)
}

// D. Repeating one concept cannot satisfy the other criteria.
{
  const stuffed =
    'sumifs sumifs sumifs xlookup xlookup xlookup sumifs xlookup sumifs xlookup sumifs xlookup extra words here to pass length checks for sure yes indeed.'
  const r = evaluateCapability('excel', OUTCOME, stuffed)
  check('D repeated terms cannot satisfy all criteria', r.satisfactory === false)
}

// E. Minimum length still enforced.
{
  const short = 'Used sumifs and xlookup on margin data with chart.'
  const r = evaluateCapability('excel', OUTCOME, short)
  check('E short response fails even with terms present', r.satisfactory === false)
  check(
    'E short response explains the length rule',
    r.improvements.some((line) => line.includes('60 characters')),
  )
}

// F. Alternative wording passes where supported.
{
  const alt =
    'I applied vlookup lookups and conditional sum formulas to the sales month data for totals. ' +
    'The resulting summary table and chart present the outcome clearly. ' +
    'This shows profit is concentrated because a few products dominate volume. ' +
    'One limitation is that I assumed stable prices, which I will verify next quarter.'
  const r = evaluateCapability('excel', OUTCOME, alt)
  check('F alternative wording (vlookup, conditional sum) passes', r.satisfactory === true)
}

// G. Gate semantics preserved: failure creates no evidence signal.
{
  const weak = 'I tried it and it was fine, really fine indeed yes.'
  const r = evaluateCapability('web', OUTCOME, weak)
  check(
    'G weak capability -> needs-work, no satisfactory result',
    r.satisfactory === false && r.result === 'needs-work',
  )
  const webGood =
    'I built the landing page with HTML headings and sections, styled the layout with CSS, and published it with a live link. ' +
    'I chose a single column because mobile traffic dominates, and one limitation is older browsers which I will check next.'
  const rw = evaluateCapability('web', OUTCOME, webGood)
  check('G web good response -> satisfactory', rw.satisfactory === true)
  check(
    'G template detection still routes correctly',
    detectTemplate('I want to learn Excel for finance') === 'excel',
  )
}

if (failures > 0) {
  console.log(`CAPABILITY-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('CAPABILITY-ALL-PASS')
