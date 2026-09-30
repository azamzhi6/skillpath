// SQLite setup for the SkillPath prototype (Phase 3).
// better-sqlite3, local file only. No ORM, no migrations framework.

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initialMasteryRow,
  nextMasteryRow,
  type CriterionOutcome,
  type MasteryRow,
} from './mastery.ts'

export const DEMO_LEARNER_ID = 'demo-learner'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = join(dataDir, 'skillpath.db')

let db: InstanceType<typeof Database>
try {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schema = readFileSync(join(here, 'schema.sql'), 'utf8')
  db.exec(schema)

  db.prepare(
    'INSERT OR IGNORE INTO learners (id, display_name) VALUES (?, ?)',
  ).run(DEMO_LEARNER_ID, 'Demo Learner')

  // Additive R1 migration for pre-existing databases: existing rows behave
  // as 'mock' via the column default.
  const feedbackCols = db
    .prepare(`PRAGMA table_info(feedback)`)
    .all() as { name: string }[]
  if (!feedbackCols.some((c) => c.name === 'prose_source')) {
    db.exec(
      `ALTER TABLE feedback ADD COLUMN prose_source TEXT NOT NULL DEFAULT 'mock'`,
    )
  }

  // Additive R2 migration: learner-confirmed parsed goal fields. Existing
  // rows keep NULLs, which the application reads as "not parsed".
  const goalCols = db
    .prepare(`PRAGMA table_info(goals)`)
    .all() as { name: string }[]
  for (const column of ['subject', 'desired_outcome', 'timeframe']) {
    if (!goalCols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE goals ADD COLUMN ${column} TEXT`)
    }
  }
} catch (err) {
  console.error(
    `SkillPath API cannot start: failed to open the SQLite database at ${dbPath}: ${
      err instanceof Error ? err.message : String(err)
    }`,
  )
  process.exit(1)
}

export interface StoredSnapshot {
  goalText: string
  template: string
  experience: string
  hoursPerWeek: string
  answers: { questionId: string; choiceId: string }[]
  score: number
  level: string
  pathTitle: string
  pathOutcome: string
  pathLevel: string
  stages: unknown[]
  completedStageIds: string[]
  parsedGoal: {
    subject: string
    desiredOutcome: string
    timeframe: string
  } | null
}

const upsertState = db.transaction((s: StoredSnapshot, now: string) => {
  const goalId = 'goal-demo'
  db.prepare(
    `INSERT INTO goals (id, learner_id, raw_text, template, experience, hours_per_week, subject, desired_outcome, timeframe, created_at, updated_at)
     VALUES (@id, @learnerId, @rawText, @template, @experience, @hoursPerWeek, @subject, @desiredOutcome, @timeframe, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       raw_text = excluded.raw_text,
       template = excluded.template,
       experience = excluded.experience,
       hours_per_week = excluded.hours_per_week,
       subject = excluded.subject,
       desired_outcome = excluded.desired_outcome,
       timeframe = excluded.timeframe,
       updated_at = excluded.updated_at`,
  ).run({
    id: goalId,
    learnerId: DEMO_LEARNER_ID,
    rawText: s.goalText,
    template: s.template,
    experience: s.experience,
    hoursPerWeek: s.hoursPerWeek,
    subject: s.parsedGoal ? s.parsedGoal.subject : null,
    desiredOutcome: s.parsedGoal ? s.parsedGoal.desiredOutcome : null,
    timeframe: s.parsedGoal ? s.parsedGoal.timeframe : null,
    now,
  })
  db.prepare(
    `INSERT INTO diagnostics (goal_id, answers_json, score, level)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(goal_id) DO UPDATE SET
       answers_json = excluded.answers_json,
       score = excluded.score,
       level = excluded.level`,
  ).run(goalId, JSON.stringify(s.answers), s.score, s.level)
  db.prepare(
    `INSERT INTO paths (goal_id, title, outcome, level, stages_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(goal_id) DO UPDATE SET
       title = excluded.title,
       outcome = excluded.outcome,
       level = excluded.level,
       stages_json = excluded.stages_json`,
  ).run(
    goalId,
    s.pathTitle,
    s.pathOutcome,
    s.pathLevel,
    JSON.stringify(s.stages),
  )
  db.prepare(
    `INSERT INTO progress (goal_id, completed_stage_ids_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(goal_id) DO UPDATE SET
       completed_stage_ids_json = excluded.completed_stage_ids_json,
       updated_at = excluded.updated_at`,
  ).run(goalId, JSON.stringify(s.completedStageIds), now)
})

export function saveSnapshot(snapshot: StoredSnapshot): void {
  upsertState(snapshot, new Date().toISOString())
}

interface GoalRow {
  raw_text: string
  template: string
  experience: string
  hours_per_week: string
  subject: string | null
  desired_outcome: string | null
  timeframe: string | null
}

interface DiagnosticRow {
  answers_json: string
  score: number
  level: string
}

interface PathRow {
  title: string
  outcome: string
  level: string
  stages_json: string
}

interface ProgressRow {
  completed_stage_ids_json: string
}

export function loadSnapshot(): StoredSnapshot | null {
  const goal = db
    .prepare('SELECT raw_text, template, experience, hours_per_week, subject, desired_outcome, timeframe FROM goals WHERE id = ?')
    .get('goal-demo') as GoalRow | undefined
  if (!goal) return null
  const diagnostic = db
    .prepare('SELECT answers_json, score, level FROM diagnostics WHERE goal_id = ?')
    .get('goal-demo') as DiagnosticRow | undefined
  const path = db
    .prepare('SELECT title, outcome, level, stages_json FROM paths WHERE goal_id = ?')
    .get('goal-demo') as PathRow | undefined
  const progress = db
    .prepare('SELECT completed_stage_ids_json FROM progress WHERE goal_id = ?')
    .get('goal-demo') as ProgressRow | undefined
  return {
    goalText: goal.raw_text,
    template: goal.template,
    experience: goal.experience,
    hoursPerWeek: goal.hours_per_week,
    parsedGoal:
      goal.subject !== null ||
      goal.desired_outcome !== null ||
      goal.timeframe !== null
        ? {
            subject: goal.subject ?? '',
            desiredOutcome: goal.desired_outcome ?? '',
            timeframe: goal.timeframe ?? '',
          }
        : null,
    answers: diagnostic ? (JSON.parse(diagnostic.answers_json) as StoredSnapshot['answers']) : [],
    score: diagnostic ? diagnostic.score : 0,
    level: diagnostic ? diagnostic.level : '',
    pathTitle: path ? path.title : '',
    pathOutcome: path ? path.outcome : '',
    pathLevel: path ? path.level : '',
    stages: path ? (JSON.parse(path.stages_json) as unknown[]) : [],
    completedStageIds: progress
      ? (JSON.parse(progress.completed_stage_ids_json) as string[])
      : [],
  }
}

export function clearAll(): void {
  const clear = db.transaction(() => {
    db.prepare('DELETE FROM learner_criterion_mastery').run()
    db.prepare('DELETE FROM capability_evidence WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE goal_id = ?)').run('goal-demo')
    db.prepare('DELETE FROM submissions WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM progress WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM paths WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM diagnostics WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM goals WHERE id = ?').run('goal-demo')
  })
  clear()
}

export interface NewSubmission {
  stageId: string
  kind: 'practice' | 'capability'
  response: string
  verdict: 'satisfactory' | 'retry' | 'remedial'
  strengths: string
  improvements: string
  nextAction: string
}

export interface StoredSubmission {
  id: string
  stageId: string
  kind: string
  response: string
  attempt: number
  createdAt: string
}

export interface StoredFeedback {
  submissionId: string
  verdict: string
  strengths: string
  improvements: string
  nextAction: string
  proseSource: string
}

export interface StoredEvidence {
  id: string
  submissionId: string
  capability: string
  result: string
  evidence: string
  demonstratedAt: string
}

export interface LearningBlock {
  submissions: StoredSubmission[]
  feedback: StoredFeedback[]
  evidence: StoredEvidence[]
  mastery: MasteryRow[]
}

interface MasteryRowShape {
  id: string
  template: string
  stage_id: string
  criterion_id: string
  attempts: number
  passes: number
  failures: number
  consecutive_failures: number
  last_result: string
  first_seen_at: string
  last_assessed_at: string
  mastery_status: string
}

function rowToMastery(row: MasteryRowShape): MasteryRow {
  return {
    template: row.template,
    stageId: row.stage_id,
    criterionId: row.criterion_id,
    attempts: row.attempts,
    passes: row.passes,
    failures: row.failures,
    consecutiveFailures: row.consecutive_failures,
    lastResult: row.last_result as MasteryRow['lastResult'],
    firstSeenAt: row.first_seen_at,
    lastAssessedAt: row.last_assessed_at,
    masteryStatus: row.mastery_status as MasteryRow['masteryStatus'],
  }
}

// Plain (non-transactional) helper: must run inside the caller's
// transaction so submission + mastery succeed or fail together.
function upsertMasteryRow(
  template: string,
  stageId: string,
  outcome: CriterionOutcome,
  now: string,
): void {
  const existing = db
    .prepare(
      'SELECT * FROM learner_criterion_mastery WHERE template = ? AND stage_id = ? AND criterion_id = ?',
    )
    .get(template, stageId, outcome.criterionId) as MasteryRowShape | undefined
  const next = existing
    ? nextMasteryRow(rowToMastery(existing), outcome.met, now)
    : initialMasteryRow(template, stageId, outcome.criterionId, outcome.met, now)
  db.prepare(
    `INSERT INTO learner_criterion_mastery (id, template, stage_id, criterion_id, attempts, passes, failures, consecutive_failures, last_result, first_seen_at, last_assessed_at, mastery_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(template, stage_id, criterion_id) DO UPDATE SET
       attempts = excluded.attempts,
       passes = excluded.passes,
       failures = excluded.failures,
       consecutive_failures = excluded.consecutive_failures,
       last_result = excluded.last_result,
       last_assessed_at = excluded.last_assessed_at,
       mastery_status = excluded.mastery_status`,
  ).run(
    existing ? existing.id : randomUUID(),
    next.template,
    next.stageId,
    next.criterionId,
    next.attempts,
    next.passes,
    next.failures,
    next.consecutiveFailures,
    next.lastResult,
    next.firstSeenAt,
    next.lastAssessedAt,
    next.masteryStatus,
  )
}

const insertSubmission = db.transaction(
  (
    s: NewSubmission,
    outcomes: CriterionOutcome[],
    template: string,
    now: string,
  ): { id: string; attempt: number } => {
    const count = db
      .prepare(
        'SELECT COUNT(*) AS n FROM submissions WHERE goal_id = ? AND stage_id = ? AND kind = ?',
      )
      .get('goal-demo', s.stageId, s.kind) as { n: number }
    const id = randomUUID()
    const attempt = count.n + 1
    db.prepare(
      `INSERT INTO submissions (id, goal_id, stage_id, kind, response, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, 'goal-demo', s.stageId, s.kind, s.response, attempt, now)
    for (const outcome of outcomes) {
      upsertMasteryRow(template, s.stageId, outcome, now)
    }
    return { id, attempt }
  },
)

export function saveSubmission(
  s: NewSubmission,
  outcomes: CriterionOutcome[],
  template: string,
): { id: string; attempt: number } {
  return insertSubmission(s, outcomes, template, new Date().toISOString())
}

export function loadMastery(): MasteryRow[] {
  return (
    db
      .prepare('SELECT * FROM learner_criterion_mastery ORDER BY template, stage_id, criterion_id')
      .all() as MasteryRowShape[]
  ).map(rowToMastery)
}

export function saveFeedback(
  submissionId: string,
  verdict: NewSubmission['verdict'],
  strengths: string,
  improvements: string,
  nextAction: string,
  proseSource: 'ai' | 'mock',
): void {
  db.prepare(
    `INSERT INTO feedback (id, submission_id, verdict, strengths, improvements, next_action, prose_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    submissionId,
    verdict,
    strengths,
    improvements,
    nextAction,
    proseSource,
    new Date().toISOString(),
  )
}

export function saveEvidence(
  submissionId: string,
  capability: string,
  result: string,
  evidence: string,
): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO capability_evidence (id, goal_id, submission_id, capability, result, evidence, demonstrated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 'goal-demo', submissionId, capability, result, evidence, new Date().toISOString())
  return id
}

export function loadLearning(): LearningBlock {
  const submissions = db
    .prepare(
      'SELECT id, stage_id AS stageId, kind, response, attempt, created_at AS createdAt FROM submissions WHERE goal_id = ? ORDER BY created_at, rowid',
    )
    .all('goal-demo') as StoredSubmission[]
  const feedback = db
    .prepare(
      'SELECT submission_id AS submissionId, verdict, strengths, improvements, next_action AS nextAction, prose_source AS proseSource FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE goal_id = ?)',
    )
    .all('goal-demo') as StoredFeedback[]
  const evidence = db
    .prepare(
      'SELECT id, submission_id AS submissionId, capability, result, evidence, demonstrated_at AS demonstratedAt FROM capability_evidence WHERE goal_id = ? ORDER BY demonstrated_at DESC, rowid DESC',
    )
    .all('goal-demo') as StoredEvidence[]
  return { submissions, feedback, evidence, mastery: loadMastery() }
}

export function dbFilePath(): string {
  return dbPath
}

export function journeyExists(): boolean {
  const row = db
    .prepare('SELECT 1 AS ok FROM goals WHERE id = ?')
    .get('goal-demo') as { ok: number } | undefined
  return row !== undefined
}

export function loadGoalText(): string {
  const row = db
    .prepare('SELECT raw_text AS rawText FROM goals WHERE id = ?')
    .get('goal-demo') as { rawText: string } | undefined
  return row ? row.rawText : ''
}

export interface StageInfo {
  title: string
  kind: string
  practice: string
  criterionIds: string[]
}

export function loadStageInfo(stageId: string): StageInfo | null {
  const row = db
    .prepare('SELECT stages_json AS stagesJson FROM paths WHERE goal_id = ?')
    .get('goal-demo') as { stagesJson: string } | undefined
  if (!row) return null
  try {
    const stages = JSON.parse(row.stagesJson) as {
      id?: unknown
      title?: unknown
      kind?: unknown
      practice?: unknown
      criteria?: unknown
    }[]
    if (!Array.isArray(stages)) return null
    const match = stages.find((s) => s.id === stageId)
    if (!match || typeof match.title !== 'string') return null
    const criterionIds = Array.isArray(match.criteria)
      ? match.criteria
          .filter(
            (c): c is { id: unknown } =>
              typeof c === 'object' && c !== null,
          )
          .map((c) => c.id)
          .filter((id): id is string => typeof id === 'string')
      : []
    return {
      title: match.title,
      kind: typeof match.kind === 'string' ? match.kind : '',
      practice: typeof match.practice === 'string' ? match.practice : '',
      criterionIds,
    }
  } catch {
    return null
  }
}
