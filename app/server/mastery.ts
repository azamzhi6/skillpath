// Learner Model Milestone 1: pure mastery-transition logic.
// No database access here, so this module is directly unit-testable.
// The deterministic evaluator decides results; these functions only
// remember them. They must never influence verdicts, completion,
// capability, or evidence.

export type MasteryResult = 'pass' | 'fail'
export type MasteryStatus = 'not_started' | 'developing' | 'demonstrated'

export interface MasteryRow {
  template: string
  stageId: string
  criterionId: string
  attempts: number
  passes: number
  failures: number
  consecutiveFailures: number
  lastResult: MasteryResult
  firstSeenAt: string
  lastAssessedAt: string
  masteryStatus: MasteryStatus
}

export interface CriterionOutcome {
  criterionId: string
  met: boolean
}

export function initialMasteryRow(
  template: string,
  stageId: string,
  criterionId: string,
  met: boolean,
  now: string,
): MasteryRow {
  if (met) {
    return {
      template,
      stageId,
      criterionId,
      attempts: 1,
      passes: 1,
      failures: 0,
      consecutiveFailures: 0,
      lastResult: 'pass',
      firstSeenAt: now,
      lastAssessedAt: now,
      masteryStatus: 'demonstrated',
    }
  }
  return {
    template,
    stageId,
    criterionId,
    attempts: 1,
    passes: 0,
    failures: 1,
    consecutiveFailures: 1,
    lastResult: 'fail',
    firstSeenAt: now,
    lastAssessedAt: now,
    masteryStatus: 'developing',
  }
}

export function nextMasteryRow(prev: MasteryRow, met: boolean, now: string): MasteryRow {
  if (met) {
    return {
      ...prev,
      attempts: prev.attempts + 1,
      passes: prev.passes + 1,
      consecutiveFailures: 0,
      lastResult: 'pass',
      lastAssessedAt: now,
      masteryStatus: 'demonstrated',
    }
  }
  return {
    ...prev,
    attempts: prev.attempts + 1,
    failures: prev.failures + 1,
    consecutiveFailures: prev.consecutiveFailures + 1,
    lastResult: 'fail',
    lastAssessedAt: now,
    masteryStatus: 'developing',
  }
}
