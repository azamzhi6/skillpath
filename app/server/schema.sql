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
  mastery_status TEXT NOT NULL CHECK (mastery_status IN ('not_started', 'developing', 'demonstrated')),
  UNIQUE (template, stage_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_mastery_template_stage
  ON learner_criterion_mastery (template, stage_id);
