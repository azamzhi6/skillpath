// PostgreSQL persistence (Netlify migration).
// pg Pool, async throughout. Same exported function names and contracts as
// the former SQLite version; only driver mechanics changed. No ORM.

import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initialMasteryRow,
  nextMasteryRow,
  type CriterionOutcome,
  type MasteryRow,
} from './mastery.ts'

export const DEMO_LEARNER_ID = 'demo-learner'

interface DbClient {
  query: <T extends Record<string, any> = Record<string, any>>(
    text: string,
    params?: any[],
  ) => Promise<{ rows: T[] }>
  release: () => void
}

interface DbPoolLike {
  query: <T extends Record<string, any> = Record<string, any>>(
    text: string,
    params?: any[],
  ) => Promise<{ rows: T[] }>
  connect: () => Promise<DbClient>
}

function connectionString(): string {
  return (
    process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
  ).trim()
}

export function databaseLabel(): string {
  if ((process.env.NETLIFY_DATABASE_URL ?? '').trim() !== '') {
    return 'postgresql (NETLIFY_DATABASE_URL)'
  }
  if ((process.env.DATABASE_URL ?? '').trim() !== '') {
    return 'postgresql (DATABASE_URL)'
  }
  return 'postgresql (no connection string configured)'
}

let activePool: DbPoolLike | null = null
let testOverride: DbPoolLike | null = null

/** Test seam only: run the data layer against another pg-compatible pool. */
export function overridePoolForTests(pool: DbPoolLike | null): void {
  testOverride = pool
}

function pool(): DbPoolLike {
  if (testOverride) return testOverride
  if (!activePool) {
    const connection = connectionString()
    if (connection === '') {
      throw new Error(
        'Missing database connection string. Set NETLIFY_DATABASE_URL or DATABASE_URL.',
      )
    }
    activePool = new Pool({
      connectionString: connection,
      max: 2,
      idleTimeoutMillis: 10000,
      // Cold serverless databases (e.g. suspended Neon compute) can take
      // well over 5s to accept the first connection; fail only past 30s.
      connectionTimeoutMillis: 30000,
    })
  }
  return activePool
}

async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Rollback failure: surface the original error.
    }
    throw err
  } finally {
    client.release()
  }
}

const here = dirname(fileURLToPath(import.meta.url))

/** Create tables and seed the demo learner. Safe to run on every startup. */
export async function initDb(): Promise<void> {
  // Create each missing table explicitly rather than relying solely on
  // IF NOT EXISTS: identical outcome on PostgreSQL, and robust across
  // lightweight pg-compatible clients used in tests.
  const existing = new Set(
    (
      await pool().query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      )
    ).rows.map((row) => row.table_name),
  )
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8')
  // schema.sql uses full-line comments only; no semicolons inside strings.
  const statements = schema
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((raw) => raw.trim())
    .filter((statement) => statement !== '')
  for (const statement of statements) {
    const table = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i.exec(statement)?.[1]
    if (table && existing.has(table)) continue
    await pool().query(statement)
  }
  await pool().query(
    'INSERT INTO learners (id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [DEMO_LEARNER_ID, 'Demo Learner'],
  )
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

export async function saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
  const s = snapshot
  const now = new Date().toISOString()
  await withTransaction(async (db) => {
    const goalId = 'goal-demo'
    await db.query(
      `INSERT INTO goals (id, learner_id, raw_text, template, experience, hours_per_week, subject, desired_outcome, timeframe, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT(id) DO UPDATE SET
         raw_text = excluded.raw_text,
         template = excluded.template,
         experience = excluded.experience,
         hours_per_week = excluded.hours_per_week,
         subject = excluded.subject,
         desired_outcome = excluded.desired_outcome,
         timeframe = excluded.timeframe,
         updated_at = excluded.updated_at`,
      [
        goalId,
        DEMO_LEARNER_ID,
        s.goalText,
        s.template,
        s.experience,
        s.hoursPerWeek,
        s.parsedGoal ? s.parsedGoal.subject : null,
        s.parsedGoal ? s.parsedGoal.desiredOutcome : null,
        s.parsedGoal ? s.parsedGoal.timeframe : null,
        now,
      ],
    )
    await db.query(
      `INSERT INTO diagnostics (goal_id, answers_json, score, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(goal_id) DO UPDATE SET
         answers_json = excluded.answers_json,
         score = excluded.score,
         level = excluded.level`,
      [goalId, JSON.stringify(s.answers), s.score, s.level],
    )
    await db.query(
      `INSERT INTO paths (goal_id, title, outcome, level, stages_json)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(goal_id) DO UPDATE SET
         title = excluded.title,
         outcome = excluded.outcome,
         level = excluded.level,
         stages_json = excluded.stages_json`,
      [goalId, s.pathTitle, s.pathOutcome, s.pathLevel, JSON.stringify(s.stages)],
    )
    await db.query(
      `INSERT INTO progress (goal_id, completed_stage_ids_json, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(goal_id) DO UPDATE SET
         completed_stage_ids_json = excluded.completed_stage_ids_json,
         updated_at = excluded.updated_at`,
      [goalId, JSON.stringify(s.completedStageIds), now],
    )
  })
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

export async function loadSnapshot(): Promise<StoredSnapshot | null> {
  const db = pool()
  const goal = (
    await db.query<GoalRow>(
      'SELECT raw_text, template, experience, hours_per_week, subject, desired_outcome, timeframe FROM goals WHERE id = $1',
      ['goal-demo'],
    )
  ).rows[0]
  if (!goal) return null
  const diagnostic = (
    await db.query<DiagnosticRow>(
      'SELECT answers_json, score, level FROM diagnostics WHERE goal_id = $1',
      ['goal-demo'],
    )
  ).rows[0]
  const path = (
    await db.query<PathRow>(
      'SELECT title, outcome, level, stages_json FROM paths WHERE goal_id = $1',
      ['goal-demo'],
    )
  ).rows[0]
  const progress = (
    await db.query<ProgressRow>(
      'SELECT completed_stage_ids_json FROM progress WHERE goal_id = $1',
      ['goal-demo'],
    )
  ).rows[0]
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

export async function clearAll(): Promise<void> {
  await withTransaction(async (db) => {
    await db.query('DELETE FROM learner_criterion_mastery', [])
    await db.query('DELETE FROM capability_evidence WHERE goal_id = $1', ['goal-demo'])
    await db.query(
      'DELETE FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE goal_id = $1)',
      ['goal-demo'],
    )
    await db.query('DELETE FROM submissions WHERE goal_id = $1', ['goal-demo'])
    await db.query('DELETE FROM progress WHERE goal_id = $1', ['goal-demo'])
    await db.query('DELETE FROM paths WHERE goal_id = $1', ['goal-demo'])
    await db.query('DELETE FROM diagnostics WHERE goal_id = $1', ['goal-demo'])
    await db.query('DELETE FROM goals WHERE id = $1', ['goal-demo'])
  })
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

export async function saveSubmission(
  s: NewSubmission,
  outcomes: CriterionOutcome[],
  template: string,
): Promise<{ id: string; attempt: number }> {
  const now = new Date().toISOString()
  return withTransaction(async (db) => {
    const count = (
      await db.query<{ n: string }>(
        'SELECT COUNT(*) AS n FROM submissions WHERE goal_id = $1 AND stage_id = $2 AND kind = $3',
        ['goal-demo', s.stageId, s.kind],
      )
    ).rows[0]
    const id = randomUUID()
    const attempt = Number(count?.n ?? 0) + 1
    await db.query(
      `INSERT INTO submissions (id, goal_id, stage_id, kind, response, attempt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, 'goal-demo', s.stageId, s.kind, s.response, attempt, now],
    )
    for (const outcome of outcomes) {
      await upsertMasteryRow(db, template, s.stageId, outcome, now)
    }
    return { id, attempt }
  })
}

async function upsertMasteryRow(
  db: DbClient,
  template: string,
  stageId: string,
  outcome: CriterionOutcome,
  now: string,
): Promise<void> {
  const existing = (
    await db.query<MasteryRowShape>(
      'SELECT * FROM learner_criterion_mastery WHERE template = $1 AND stage_id = $2 AND criterion_id = $3',
      [template, stageId, outcome.criterionId],
    )
  ).rows[0]
  const next = existing
    ? nextMasteryRow(rowToMastery(existing), outcome.met, now)
    : initialMasteryRow(template, stageId, outcome.criterionId, outcome.met, now)
  await db.query(
    `INSERT INTO learner_criterion_mastery (id, template, stage_id, criterion_id, attempts, passes, failures, consecutive_failures, last_result, first_seen_at, last_assessed_at, mastery_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT(template, stage_id, criterion_id) DO UPDATE SET
       attempts = excluded.attempts,
       passes = excluded.passes,
       failures = excluded.failures,
       consecutive_failures = excluded.consecutive_failures,
       last_result = excluded.last_result,
       last_assessed_at = excluded.last_assessed_at,
       mastery_status = excluded.mastery_status`,
    [
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
    ],
  )
}

export async function loadMastery(): Promise<MasteryRow[]> {
  const rows = (
    await pool().query<MasteryRowShape>(
      'SELECT * FROM learner_criterion_mastery ORDER BY template, stage_id, criterion_id',
    )
  ).rows
  return rows.map(rowToMastery)
}

export async function saveFeedback(
  submissionId: string,
  verdict: NewSubmission['verdict'],
  strengths: string,
  improvements: string,
  nextAction: string,
  proseSource: 'ai' | 'mock',
): Promise<void> {
  await pool().query(
    `INSERT INTO feedback (id, submission_id, verdict, strengths, improvements, next_action, prose_source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      submissionId,
      verdict,
      strengths,
      improvements,
      nextAction,
      proseSource,
      new Date().toISOString(),
    ],
  )
}

export async function saveEvidence(
  submissionId: string,
  capability: string,
  result: string,
  evidence: string,
): Promise<string> {
  const id = randomUUID()
  await pool().query(
    `INSERT INTO capability_evidence (id, goal_id, submission_id, capability, result, evidence, demonstrated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, 'goal-demo', submissionId, capability, result, evidence, new Date().toISOString()],
  )
  return id
}

export async function loadLearning(): Promise<LearningBlock> {
  const db = pool()
  const submissions = (
    await db.query<StoredSubmission>(
      'SELECT id, stage_id AS "stageId", kind, response, attempt, created_at AS "createdAt" FROM submissions WHERE goal_id = $1 ORDER BY created_at, id',
      ['goal-demo'],
    )
  ).rows
  const feedback = (
    await db.query<StoredFeedback>(
      'SELECT submission_id AS "submissionId", verdict, strengths, improvements, next_action AS "nextAction", prose_source AS "proseSource" FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE goal_id = $1)',
      ['goal-demo'],
    )
  ).rows
  const evidence = (
    await db.query<StoredEvidence>(
      'SELECT id, submission_id AS "submissionId", capability, result, evidence, demonstrated_at AS "demonstratedAt" FROM capability_evidence WHERE goal_id = $1 ORDER BY demonstrated_at DESC, id DESC',
      ['goal-demo'],
    )
  ).rows
  return { submissions, feedback, evidence, mastery: await loadMastery() }
}

export async function journeyExists(): Promise<boolean> {
  const rows = (
    await pool().query<{ ok: number }>('SELECT 1 AS ok FROM goals WHERE id = $1', [
      'goal-demo',
    ])
  ).rows
  return rows.length > 0
}

export async function loadGoalText(): Promise<string> {
  const rows = (
    await pool().query<{ rawText: string }>(
      'SELECT raw_text AS "rawText" FROM goals WHERE id = $1',
      ['goal-demo'],
    )
  ).rows
  return rows.length > 0 ? rows[0].rawText : ''
}

export interface StageInfo {
  title: string
  kind: string
  practice: string
  criterionIds: string[]
}

export async function loadStageInfo(stageId: string): Promise<StageInfo | null> {
  const rows = (
    await pool().query<{ stagesJson: string }>(
      'SELECT stages_json AS "stagesJson" FROM paths WHERE goal_id = $1',
      ['goal-demo'],
    )
  ).rows
  const row = rows[0]
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
