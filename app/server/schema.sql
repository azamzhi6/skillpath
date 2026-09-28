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
