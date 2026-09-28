// SQLite setup for the SkillPath prototype (Phase 3).
// better-sqlite3, local file only. No ORM, no migrations framework.

import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEMO_LEARNER_ID = 'demo-learner'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = join(dataDir, 'skillpath.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const schema = readFileSync(join(here, 'schema.sql'), 'utf8')
db.exec(schema)

db.prepare(
  'INSERT OR IGNORE INTO learners (id, display_name) VALUES (?, ?)',
).run(DEMO_LEARNER_ID, 'Demo Learner')

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
}

const upsertState = db.transaction((s: StoredSnapshot, now: string) => {
  const goalId = 'goal-demo'
  db.prepare(
    `INSERT INTO goals (id, learner_id, raw_text, template, experience, hours_per_week, created_at, updated_at)
     VALUES (@id, @learnerId, @rawText, @template, @experience, @hoursPerWeek, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       raw_text = excluded.raw_text,
       template = excluded.template,
       experience = excluded.experience,
       hours_per_week = excluded.hours_per_week,
       updated_at = excluded.updated_at`,
  ).run({
    id: goalId,
    learnerId: DEMO_LEARNER_ID,
    rawText: s.goalText,
    template: s.template,
    experience: s.experience,
    hoursPerWeek: s.hoursPerWeek,
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
    .prepare('SELECT raw_text, template, experience, hours_per_week FROM goals WHERE id = ?')
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
    db.prepare('DELETE FROM progress WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM paths WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM diagnostics WHERE goal_id = ?').run('goal-demo')
    db.prepare('DELETE FROM goals WHERE id = ?').run('goal-demo')
  })
  clear()
}

export function dbFilePath(): string {
  return dbPath
}
