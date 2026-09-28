# SkillPath — PRD.md

## Authoritative product specification

The authoritative product requirements for SkillPath v1.0 (Product Definition / MVP Planning)
are in `SKILLPATH PRD.docx` in this repository.

This `PRD.md` file does NOT replace or rewrite those requirements. It exists only to
document AI steering instructions and implementation decisions for the incubator
assessment, as required by the assessment.

## Task 1 AI steering decision — persistence (DECIDED)

**Decision:** Use **SQLite via better-sqlite3 + a thin local Express API** for prototype
persistence. Keep the implementation deliberately minimal.

**Alternatives considered:**

1. SQLite + thin Express API (chosen).
2. Frontend-only localStorage with no backend (rejected for this prototype).

**Rationale (owner-approved):**

- SkillPath has a relational data model involving learners, learning goals, learning
  paths, activities and progress.
- SQLite provides genuine relational persistence while remaining lightweight and
  fully local.
- The Task 1 requirements explicitly require naming a database and stating that the
  application and database run locally.
- A thin Express API gives the prototype a clean separation between the React
  frontend and the data layer without introducing unnecessary infrastructure such
  as PostgreSQL, Docker or cloud services.
- Although frontend-only localStorage would be simpler, SQLite better reflects the
  eventual architecture of SkillPath while remaining practical for the local prototype.
- Implementation stays deliberately minimal; no production backend infrastructure
  will be built.

**Consequences for the plan:**

- Phases 1–2 run frontend-only behind a storage-adapter interface so the central
  learner experience (goal → clarification → path → next action) is testable first.
- SQLite + thin Express API is introduced in Phase 3 for `User`, `LearningGoal`,
  `LearningPath` (stages embedded as JSON) and `LearnerState` only.
- Minimum data model, mock AI boundary, deferred PRD §16 features, and the
  local-only boundary (local app, local DB, mock data, no secrets, no deployment)
  are unchanged.

**Scope guard:** This decision does not expand the prototype scope. No additional
backend features, tables, auth system, file uploads, or deployment work are
authorised by this decision.

## Task 1 — Implementation Plan

Ordered prototype phases with each phase's objective and concrete output. Phase 3
backend is now implemented (SQLite + thin Express API); the browser copy
remains as an offline fallback.

**Phase 0 — Baseline & Guardrails**

- Objective: establish the project baseline, scope boundaries, local runtime and architectural guardrails.
- Output: agreed local stack, repository structure, scope guardrails and prototype constraints.

**Phase 1 — Goal Capture + Mock Clarification**

- Objective: implement the learner's initial goal capture and clarification experience.
- Output: working goal-entry flow with deterministic/mock clarification.

**Phase 2 — Diagnostic + Personalised Learning Path**

- Objective: assess the learner's starting point and generate a personalised learning pathway.
- Output: diagnostic flow, personalised path, stages/practice tasks and Next Action.

**Phase 3 — Progress Persistence & Data Layer**

- Objective: replace temporary browser persistence with the planned local data layer.
- Output: SQLite (`better-sqlite3`) database and thin local Express API behind the existing storage interface.

**Phase 4 — Prototype Hardening & Handoff**

- Objective: validate the prototype, improve reliability and prepare the assessment/demo handoff.
- Output: tested local prototype, documentation and demo-ready repository.

### Local execution

The application runs locally via `npm run dev`.

The database runs locally as a SQLite file.

### Authentication

Authentication is mocked: a single local demo learner is used, with no passwords or tokens stored.

### File storage

SkillPath does not require file uploads for this prototype, so no file-storage service is required.

### Reviewed Tool Choice — Persistence

We chose SQLite with a thin local Express API. It suits SkillPath because it gives real relational tables for goals, paths and progress while remaining a lightweight local database.

This note complements the detailed decision rationale above; it does not replace it.

## Task 2 — Design Refinement: typography and readability (DECIDED)

**Original typography approach:** `design.html` used a system font stack with a flat
scale — 32px bold main heading, 22px semibold subheading, 16px regular body at
1.55 line-height, 13px muted supporting text, and a 16px regular goal input.

**Refinement requested:** make the main heading more prominent without becoming
oversized; increase distinction between headings, body and supporting text; improve
paragraph/instructional line-height; make the learning-goal input highly readable;
keep the design clean and professional with no color, layout, functionality or
architecture changes.

**Resulting design change:** main heading and display sample moved to 36px
extra-bold with tighter tracking and line-height; subheadings set to bold with
refined spacing; body sample set to 17px with 1.7 line-height (page base 1.65);
supporting text, hints, messages and card copy given explicit relaxed line-heights;
goal input and its label raised to 17px medium for readability. Color palette,
layout, buttons (other than inherited text rendering) and behavior are unchanged.

## Task 2 - Design Refinement (typography readability)

ASCII alias for the "Task 2 — Design Refinement: typography and readability
(DECIDED)" note above; see that section for the full refinement record.
