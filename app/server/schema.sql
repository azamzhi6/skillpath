-- SkillPath prototype database (Phase 3).
-- Five tables only: learner, goal, diagnostic/context, learning path, progress.
-- Stages, answers and progress lists are stored as JSON; no extra tables.

CREATE TABLE IF NOT EXISTS learners (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  raw_text TEXT NOT NULL,
  template TEXT NOT NULL,
  experience TEXT NOT NULL,
  hours_per_week TEXT NOT NULL,
  subject TEXT,
  desired_outcome TEXT,
  timeframe TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostics (
  goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL,
  score INTEGER NOT NULL,
  level TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paths (
  goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  level TEXT NOT NULL,
  stages_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  completed_stage_ids_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Phase 5 learning loop. Activities are NOT stored: an activity is derived
-- from a stage in paths.stages_json (stage_id + kind). Only attempts,
-- evaluations and demonstrated capability persist.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('practice', 'capability')),
  response TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  created_at TEXT NOT NULL,
  UNIQUE (goal_id, stage_id, kind, attempt)
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('satisfactory', 'retry', 'remedial')),
  strengths TEXT NOT NULL,
  improvements TEXT NOT NULL,
  next_action TEXT NOT NULL,
  prose_source TEXT NOT NULL DEFAULT 'mock' CHECK (prose_source IN ('ai', 'mock')),
  created_at TEXT NOT NULL
);

-- No UNIQUE on goal_id: a goal may have more than one successful
-- demonstration. The UI displays the latest successful demonstration.
CREATE TABLE IF NOT EXISTS capability_evidence (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  result TEXT NOT NULL,
  evidence TEXT NOT NULL,
  demonstrated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_goal_stage
  ON submissions (goal_id, stage_id, kind);
CREATE INDEX IF NOT EXISTS idx_capability_evidence_goal
  ON capability_evidence (goal_id, demonstrated_at);

-- Learner Model Milestone 1: observational memory of deterministic
-- criterion results. Written only from stored assessment outcomes; never
-- read by any gating logic. Reset with everything else via clearAll.
CREATE TABLE IF NOT EXISTS learner_criterion_mastery (
  id TEXT PRIMARY KEY,
  learner_id TEXT,
  template TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  passes INTEGER NOT NULL CHECK (passes >= 0),
  failures INTEGER NOT NULL CHECK (failures >= 0),
  consecutive_failures INTEGER NOT NULL CHECK (consecutive_failures >= 0),
  last_result TEXT NOT NULL CHECK (last_result IN ('pass', 'fail')),
  first_seen_at TEXT NOT NULL,
  last_assessed_at TEXT NOT NULL,
  mastery_status TEXT NOT NULL CHECK (mastery_status IN ('not_started', 'developing', 'demonstrated'))
);

CREATE INDEX IF NOT EXISTS idx_mastery_template_stage
  ON learner_criterion_mastery (template, stage_id);

-- Per-learner ownership (Phase 1 corrective pass). Unique indexes rather
-- than inline constraints so the initDb loop applies them idempotently to
-- fresh and existing databases alike; ON CONFLICT(learner_id[, ...])
-- targets resolve against these on PostgreSQL and pg-mem.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mastery_learner_unique
  ON learner_criterion_mastery (learner_id, template, stage_id, criterion_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_learner_unique
  ON goals (learner_id);

-- Phase 1 (Auth): learner accounts and server-side sessions.
-- Additive only: existing tables above are untouched. initDb() applies these
-- on fresh and existing databases (CREATE TABLE/INDEX IF NOT EXISTS);
-- the mastery learner_id backfill lives in db.ts runPhase1Migrations().
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner', 'admin')),
  learner_id TEXT NOT NULL UNIQUE REFERENCES learners(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

-- Stub for future self-service password reset (no helpers or routes yet).
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_learner
  ON users (learner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires
  ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON login_attempts (email, attempted_at);

-- DB-enforced case-insensitive email uniqueness. Complements the
-- application-level normalization in createUser/findUserByEmail so that
-- direct database writes cannot create case-variant duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email));
