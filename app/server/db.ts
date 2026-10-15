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
export const DEMO_USER_ID = 'user-demo'
export const DEMO_USER_EMAIL = 'demo@skillpath.local'

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
  // Pass 1: tables only. Pass 2 (indexes) runs after runPhase1Migrations
  // below, so indexes referencing migrated columns (e.g. mastery
  // learner_id) are never created before the column exists — on fresh and
  // legacy databases alike.
  for (const statement of statements) {
    const table = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i.exec(statement)?.[1]
    if (!table) continue
    if (existing.has(table)) continue
    await pool().query(statement)
  }
  await pool().query(
    'INSERT INTO learners (id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [DEMO_LEARNER_ID, 'Demo Learner'],
  )
  await runPhase1Migrations()
  for (const statement of statements) {
    const table = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i.exec(statement)?.[1]
    if (table) continue
    await pool().query(statement)
  }
}

/**
 * Phase 1 auth migration. Additive and rerunnable:
 * - new tables arrive via schema.sql (CREATE TABLE IF NOT EXISTS)
 * - mastery.learner_id is added only when missing, then backfilled to the
 *   demo learner so pre-existing rows are preserved
 * - the legacy global UNIQUE on (template, stage_id, criterion_id) is
 *   dropped so different learners can share criteria; per-learner
 *   uniqueness comes from idx_mastery_learner_unique (schema.sql)
 * - single-goal-per-learner comes from idx_goals_learner_unique (schema.sql)
 * Safe on fresh DBs (ALTER/DROP miss gracefully), existing DBs, repeated
 * startups, and concurrent serverless cold starts (duplicate-column races
 * are ignored; all other errors propagate).
 */
async function runPhase1Migrations(): Promise<void> {
  const db = pool()
  try {
    await db.query('ALTER TABLE learner_criterion_mastery ADD COLUMN learner_id TEXT')
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err
  }
  await db.query(
    'UPDATE learner_criterion_mastery SET learner_id = $1 WHERE learner_id IS NULL',
    [DEMO_LEARNER_ID],
  )
  // PostgreSQL names an inline UNIQUE deterministically as
  // {table}_{columns}_key. IF EXISTS keeps this a safe no-op on fresh
  // databases, on reruns, and on engines that never created it under this
  // name (pg-mem uses internal hash names — see the test limitation note).
  await db.query('ALTER TABLE learner_criterion_mastery DROP CONSTRAINT IF EXISTS learner_criterion_mastery_template_stage_id_criterion_id_key')
  // Demo identity for server-issued demo sessions: bound to the demo
  // learner with a password hash that can never verify ('UNUSABLE' is not
  // a valid bcrypt hash, and the login route rejects this address outright).
  await db.query(
    `INSERT INTO users (id, email, password_hash, role, learner_id, created_at)
     VALUES ($1, $2, 'UNUSABLE', 'learner', $3, $4)
     ON CONFLICT DO NOTHING`,
    [DEMO_USER_ID, DEMO_USER_EMAIL, DEMO_LEARNER_ID, new Date().toISOString()],
  )
}

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code
    if (code === '42701' || code === '42710') return true
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && /already exists|duplicate/i.test(message)) {
      return true
    }
  }
  return false
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
  // Demo reset only: the demo journey now lives under a generated goal id,
  // so delegate to the learner-scoped reset. Registered learners carry
  // different learner_ids and are never touched.
  await clearAllForLearner(DEMO_LEARNER_ID)
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
  learner_id: string | null
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
  // Demo journey rows are attributed to the demo learner so the per-learner
  // uniqueness index applies uniformly. Transitions are identical (same
  // initial/nextMasteryRow math as before).
  await upsertMasteryRowForLearner(db, DEMO_LEARNER_ID, template, stageId, outcome, now)
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

export async function saveEvidenceForLearner(
  learnerId: string,
  submissionId: string,
  capability: string,
  result: string,
  evidence: string,
): Promise<string> {
  const db = pool()
  const goalId = await findGoalIdForLearner(db, learnerId)
  if (goalId === null) throw new Error('No active learning journey')
  const owner = (
    await db.query<{ goalId: string }>(
      'SELECT goal_id AS "goalId" FROM submissions WHERE id = $1',
      [submissionId],
    )
  ).rows[0]
  if (!owner || owner.goalId !== goalId) {
    throw new Error('Submission does not belong to learner')
  }
  const id = randomUUID()
  await db.query(
    `INSERT INTO capability_evidence (id, goal_id, submission_id, capability, result, evidence, demonstrated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, goalId, submissionId, capability, result, evidence, new Date().toISOString()],
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

// ---- Phase 1 (Auth) Task 1: per-learner ownership stores ----
// Schema + data helpers only. No routes, no frontend changes, no password or
// session-token crypto here: callers pass already-hashed values (hashing lands
// with the auth-route task). Every helper takes an explicit learnerId/userId
// and never falls back to the shared demo goal, so one learner's rows are
// invisible to another. Existing demo functions above are untouched.

export type UserRole = 'learner' | 'admin'

export interface StoredUser {
  id: string
  email: string
  role: UserRole
  learnerId: string
  createdAt: string
}

export interface StoredUserCredentials extends StoredUser {
  // Server-only. Never serialize to the frontend.
  passwordHash: string
}

export interface StoredSession {
  id: string
  userId: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string
}

export interface AuthenticatedSession {
  session: StoredSession
  user: StoredUser
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isUniqueViolationError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code
    if (code === '23505') return true
    const message = (err as { message?: unknown }).message
    if (
      typeof message === 'string' &&
      /duplicate|already exists|unique/i.test(message)
    ) {
      return true
    }
  }
  return false
}

/** Insert a learners row if missing. Used when provisioning accounts. */
export async function ensureLearner(
  learnerId: string,
  displayName: string,
): Promise<void> {
  await pool().query(
    'INSERT INTO learners (id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [learnerId, displayName],
  )
}

async function emailTaken(email: string): Promise<boolean> {
  const rows = (
    await pool().query<{ ok: number }>('SELECT 1 AS ok FROM users WHERE email = $1', [
      email,
    ])
  ).rows
  return rows.length > 0
}

export async function createUser(input: {
  email: string
  passwordHash: string
  displayName?: string
  role?: UserRole
}): Promise<StoredUser> {
  const email = normalizeEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email')
  if (typeof input.passwordHash !== 'string' || input.passwordHash.length < 10) {
    throw new Error('Invalid password hash')
  }
  // Role is server-controlled: the later public-registration route always
  // passes 'learner' or omits role. No client input may reach this parameter.
  const role: UserRole = input.role ?? 'learner'
  if (role !== 'learner' && role !== 'admin') throw new Error('Invalid role')
  const now = new Date().toISOString()
  const learnerId = `learner-${randomUUID()}`
  const id = randomUUID()
  try {
    await withTransaction(async (db) => {
      await db.query(
        'INSERT INTO learners (id, display_name) VALUES ($1, $2)',
        [
          learnerId,
          input.displayName && input.displayName.trim() !== ''
            ? input.displayName.trim()
            : email,
        ],
      )
      await db.query(
        'INSERT INTO users (id, email, password_hash, role, learner_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, email, input.passwordHash, role, learnerId, now],
      )
    })
  } catch (err) {
    // Report an email conflict only when the address is actually taken:
    // unrelated uniqueness failures must surface unchanged.
    if (isUniqueViolationError(err) && (await emailTaken(email))) {
      throw new Error('Email already registered')
    }
    throw err
  }
  return { id, email, role, learnerId, createdAt: now }
}

interface UserRow {
  id: string
  email: string
  role: string
  learnerId: string
  createdAt: string
}

function toStoredUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    learnerId: row.learnerId,
    createdAt: row.createdAt,
  }
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const row = (
    await pool().query<UserRow>(
      'SELECT id, email, role, learner_id AS "learnerId", created_at AS "createdAt" FROM users WHERE email = $1',
      [normalizeEmail(email)],
    )
  ).rows[0]
  if (!row) return null
  return toStoredUser(row)
}

export async function findUserCredentialsByEmail(
  email: string,
): Promise<StoredUserCredentials | null> {
  const row = (
    await pool().query<UserRow & { passwordHash: string }>(
      'SELECT id, email, role, learner_id AS "learnerId", password_hash AS "passwordHash", created_at AS "createdAt" FROM users WHERE email = $1',
      [normalizeEmail(email)],
    )
  ).rows[0]
  if (!row) return null
  return { ...toStoredUser(row), passwordHash: row.passwordHash }
}

export async function createSession(input: {
  userId: string
  tokenHash: string
  expiresAt: string
}): Promise<StoredSession> {
  if (!input.userId || !input.tokenHash || !input.expiresAt) {
    throw new Error('Invalid session')
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  await pool().query(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, input.userId, input.tokenHash, now, input.expiresAt, now],
  )
  return { id, userId: input.userId, createdAt: now, expiresAt: input.expiresAt, lastSeenAt: now }
}

interface SessionJoinRow {
  sessionId: string
  userId: string
  sessionCreatedAt: string
  sessionExpiresAt: string
  sessionLastSeenAt: string
  uId: string
  uEmail: string
  uRole: string
  uLearnerId: string
  uCreatedAt: string
}

export async function findSessionByTokenHash(
  tokenHash: string,
): Promise<AuthenticatedSession | null> {
  const now = new Date().toISOString()
  const row = (
    await pool().query<SessionJoinRow>(
      `SELECT s.id AS "sessionId", s.user_id AS "userId", s.created_at AS "sessionCreatedAt", s.expires_at AS "sessionExpiresAt", s.last_seen_at AS "sessionLastSeenAt",
              u.id AS "uId", u.email AS "uEmail", u.role AS "uRole", u.learner_id AS "uLearnerId", u.created_at AS "uCreatedAt"
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash, now],
    )
  ).rows[0]
  if (!row) return null
  return {
    session: {
      id: row.sessionId,
      userId: row.userId,
      createdAt: row.sessionCreatedAt,
      expiresAt: row.sessionExpiresAt,
      lastSeenAt: row.sessionLastSeenAt,
    },
    user: {
      id: row.uId,
      email: row.uEmail,
      role: row.uRole as UserRole,
      learnerId: row.uLearnerId,
      createdAt: row.uCreatedAt,
    },
  }
}

export async function refreshSessionLastSeen(id: string): Promise<void> {
  await pool().query('UPDATE sessions SET last_seen_at = $1 WHERE id = $2', [
    new Date().toISOString(),
    id,
  ])
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await pool().query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await pool().query('DELETE FROM sessions WHERE user_id = $1', [userId])
}

export async function purgeExpiredSessions(): Promise<void> {
  await pool().query('DELETE FROM sessions WHERE expires_at <= $1', [
    new Date().toISOString(),
  ])
}

export async function recordLoginAttempt(input: {
  email: string
  ip: string
}): Promise<void> {
  const email = normalizeEmail(input.email)
  const ip = input.ip.trim() === '' ? 'unknown' : input.ip.trim().slice(0, 200)
  await pool().query(
    'INSERT INTO login_attempts (id, email, ip, attempted_at) VALUES ($1, $2, $3, $4)',
    [randomUUID(), email, ip, new Date().toISOString()],
  )
}

export async function countRecentLoginAttempts(input: {
  email: string
  sinceIso: string
}): Promise<number> {
  const row = (
    await pool().query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE email = $1 AND attempted_at > $2',
      [normalizeEmail(input.email), input.sinceIso],
    )
  ).rows[0]
  return Number(row?.n ?? 0)
}

async function findGoalIdForLearner(
  db: Pick<DbPoolLike, 'query'>,
  learnerId: string,
): Promise<string | null> {
  const rows = (
    await db.query<{ id: string }>(
      'SELECT id FROM goals WHERE learner_id = $1 ORDER BY updated_at DESC',
      [learnerId],
    )
  ).rows
  return rows.length > 0 ? rows[0].id : null
}

export async function saveSnapshotForLearner(
  learnerId: string,
  snapshot: StoredSnapshot,
): Promise<void> {
  const s = snapshot
  const now = new Date().toISOString()
  await withTransaction(async (db) => {
    // Single-statement upsert on the per-learner unique index: concurrent
    // first saves converge on one goal row instead of forking. On conflict
    // the whole snapshot is replaced (last writer wins) — never torn and
    // never silently discarded. The generated id is used only on insert.
    const candidateId = `goal-${randomUUID()}`
    await db.query(
      `INSERT INTO goals (id, learner_id, raw_text, template, experience, hours_per_week, subject, desired_outcome, timeframe, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT(learner_id) DO UPDATE SET
         raw_text = excluded.raw_text,
         template = excluded.template,
         experience = excluded.experience,
         hours_per_week = excluded.hours_per_week,
         subject = excluded.subject,
         desired_outcome = excluded.desired_outcome,
         timeframe = excluded.timeframe,
         updated_at = excluded.updated_at`,
      [
        candidateId,
        learnerId,
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
    const goalId = await findGoalIdForLearner(db, learnerId)
    if (goalId === null) throw new Error('Could not resolve learner goal')
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

export async function loadSnapshotForLearner(
  learnerId: string,
): Promise<StoredSnapshot | null> {
  const db = pool()
  const goalId = await findGoalIdForLearner(db, learnerId)
  if (goalId === null) return null
  const goal = (
    await db.query<GoalRow>(
      'SELECT raw_text, template, experience, hours_per_week, subject, desired_outcome, timeframe FROM goals WHERE id = $1',
      [goalId],
    )
  ).rows[0]
  if (!goal) return null
  const diagnostic = (
    await db.query<DiagnosticRow>(
      'SELECT answers_json, score, level FROM diagnostics WHERE goal_id = $1',
      [goalId],
    )
  ).rows[0]
  const path = (
    await db.query<PathRow>(
      'SELECT title, outcome, level, stages_json FROM paths WHERE goal_id = $1',
      [goalId],
    )
  ).rows[0]
  const progress = (
    await db.query<ProgressRow>(
      'SELECT completed_stage_ids_json FROM progress WHERE goal_id = $1',
      [goalId],
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

export async function journeyExistsForLearner(learnerId: string): Promise<boolean> {
  const rows = (
    await pool().query<{ ok: number }>(
      'SELECT 1 AS ok FROM goals WHERE learner_id = $1',
      [learnerId],
    )
  ).rows
  return rows.length > 0
}

export async function clearAllForLearner(learnerId: string): Promise<void> {
  await withTransaction(async (db) => {
    const goalIds = (
      await db.query<{ id: string }>('SELECT id FROM goals WHERE learner_id = $1', [
        learnerId,
      ])
    ).rows.map((row) => row.id)
    for (const goalId of goalIds) {
      await db.query('DELETE FROM capability_evidence WHERE goal_id = $1', [goalId])
      await db.query(
        'DELETE FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE goal_id = $1)',
        [goalId],
      )
      await db.query('DELETE FROM submissions WHERE goal_id = $1', [goalId])
      await db.query('DELETE FROM progress WHERE goal_id = $1', [goalId])
      await db.query('DELETE FROM paths WHERE goal_id = $1', [goalId])
      await db.query('DELETE FROM diagnostics WHERE goal_id = $1', [goalId])
      await db.query('DELETE FROM goals WHERE id = $1', [goalId])
    }
    await db.query('DELETE FROM learner_criterion_mastery WHERE learner_id = $1', [
      learnerId,
    ])
  })
}

export async function saveSubmissionForLearner(
  learnerId: string,
  s: NewSubmission,
  outcomes: CriterionOutcome[],
  template: string,
): Promise<{ id: string; attempt: number }> {
  const now = new Date().toISOString()
  return withTransaction(async (db) => {
    const goalId = await findGoalIdForLearner(db, learnerId)
    if (goalId === null) throw new Error('No active learning journey')
    const count = (
      await db.query<{ n: string }>(
        'SELECT COUNT(*) AS n FROM submissions WHERE goal_id = $1 AND stage_id = $2 AND kind = $3',
        [goalId, s.stageId, s.kind],
      )
    ).rows[0]
    const id = randomUUID()
    const attempt = Number(count?.n ?? 0) + 1
    await db.query(
      `INSERT INTO submissions (id, goal_id, stage_id, kind, response, attempt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, goalId, s.stageId, s.kind, s.response, attempt, now],
    )
    for (const outcome of outcomes) {
      await upsertMasteryRowForLearner(db, learnerId, template, s.stageId, outcome, now)
    }
    return { id, attempt }
  })
}

async function upsertMasteryRowForLearner(
  db: DbClient,
  learnerId: string,
  template: string,
  stageId: string,
  outcome: CriterionOutcome,
  now: string,
): Promise<void> {
  // Manual upsert (no ON CONFLICT): lookup/update/insert is scoped to this learner.
  const existing = (
    await db.query<MasteryRowShape>(
      'SELECT * FROM learner_criterion_mastery WHERE learner_id = $1 AND template = $2 AND stage_id = $3 AND criterion_id = $4',
      [learnerId, template, stageId, outcome.criterionId],
    )
  ).rows[0]
  const next = existing
    ? nextMasteryRow(rowToMastery(existing), outcome.met, now)
    : initialMasteryRow(template, stageId, outcome.criterionId, outcome.met, now)
  if (existing) {
    await db.query(
      `UPDATE learner_criterion_mastery SET attempts = $1, passes = $2, failures = $3,
        consecutive_failures = $4, last_result = $5, last_assessed_at = $6, mastery_status = $7 WHERE id = $8`,
      [
        next.attempts,
        next.passes,
        next.failures,
        next.consecutiveFailures,
        next.lastResult,
        next.lastAssessedAt,
        next.masteryStatus,
        existing.id,
      ],
    )
  } else {
    await db.query(
      `INSERT INTO learner_criterion_mastery (id, learner_id, template, stage_id, criterion_id, attempts, passes, failures, consecutive_failures, last_result, first_seen_at, last_assessed_at, mastery_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        randomUUID(),
        learnerId,
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
}

export async function loadMasteryForLearner(learnerId: string): Promise<MasteryRow[]> {
  const rows = (
    await pool().query<MasteryRowShape>(
      'SELECT * FROM learner_criterion_mastery WHERE learner_id = $1 ORDER BY template, stage_id, criterion_id',
      [learnerId],
    )
  ).rows
  return rows.map(rowToMastery)
}

export async function loadLearningForLearner(learnerId: string): Promise<LearningBlock> {
  const db = pool()
  const goalId = await findGoalIdForLearner(db, learnerId)
  if (goalId === null) {
    return { submissions: [], feedback: [], evidence: [], mastery: await loadMasteryForLearner(learnerId) }
  }
  const submissions = (
    await db.query<StoredSubmission>(
      'SELECT id, stage_id AS "stageId", kind, response, attempt, created_at AS "createdAt" FROM submissions WHERE goal_id = $1 ORDER BY created_at, id',
      [goalId],
    )
  ).rows
  const feedback = (
    await db.query<StoredFeedback>(
      'SELECT submission_id AS "submissionId", verdict, strengths, improvements, next_action AS "nextAction", prose_source AS "proseSource" FROM feedback WHERE submission_id IN (SELECT id FROM submissions WHERE goal_id = $1)',
      [goalId],
    )
  ).rows
  const evidence = (
    await db.query<StoredEvidence>(
      'SELECT id, submission_id AS "submissionId", capability, result, evidence, demonstrated_at AS "demonstratedAt" FROM capability_evidence WHERE goal_id = $1 ORDER BY demonstrated_at DESC, id DESC',
      [goalId],
    )
  ).rows
  return { submissions, feedback, evidence, mastery: await loadMasteryForLearner(learnerId) }
}

export async function loadGoalTextForLearner(learnerId: string): Promise<string> {
  const db = pool()
  const goalId = await findGoalIdForLearner(db, learnerId)
  if (goalId === null) return ''
  const rows = (
    await db.query<{ rawText: string }>(
      'SELECT raw_text AS "rawText" FROM goals WHERE id = $1',
      [goalId],
    )
  ).rows
  return rows.length > 0 ? rows[0].rawText : ''
}

export async function loadStageInfoForLearner(
  learnerId: string,
  stageId: string,
): Promise<StageInfo | null> {
  const db = pool()
  const goalId = await findGoalIdForLearner(db, learnerId)
  if (goalId === null) return null
  const rows = (
    await db.query<{ stagesJson: string }>(
      'SELECT stages_json AS "stagesJson" FROM paths WHERE goal_id = $1',
      [goalId],
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
