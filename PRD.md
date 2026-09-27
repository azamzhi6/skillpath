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
