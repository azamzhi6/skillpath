# SkillPath — Personalised AI Learning Coach

Initial version (v1.0 PRD definition / MVP planning). No code yet — this repo currently captures the product definition.

> One-sentence definition: SkillPath is a personalised AI learning coach that turns what a person wants to learn into an adaptive journey of learning, practice, feedback and application that helps them progress from intention to demonstrated capability.

## What is the product?

SkillPath helps people learn a skill, subject, task or capability and make meaningful progress toward actually being able to do it.

The learner tells SkillPath what they want to learn. SkillPath then:
- determines the starting point,
- defines an appropriate learning goal,
- creates a personalised learning path,
- identifies relevant knowledge and resources,
- guides learning activities with demonstrations and practice,
- evaluates progress, gives feedback, and adapts the journey.

Central philosophy: **Want to learn → Understand → See → Practise → Get feedback → Improve → Demonstrate ability**

It is designed around progressive capability development, not just delivering courses. The AI is the primary interface — acting as coach, guide, explainer, practice partner, evaluator and adaptive companion.

Product promise: **Tell SkillPath what you want to learn. It figures out how to help you get there.**

## Problem it solves

People have access to enormous amounts of educational content, but access to information does not produce learning or capability.

Learners struggle to determine:
- where to start, what to learn first / next,
- what they already know,
- which resources are relevant,
- how to practise, whether they are practising correctly,
- how to apply learning, whether they are improving,
- when they are ready to perform independently.

Existing platforms organise around predefined courses and content libraries. SkillPath starts from the opposite direction: the learner's goal, then dynamically constructs and adapts the experience around that goal.

## Users

**Primary — Learner:** Anyone who wants to learn a skill, subject, task or capability and needs personalised guidance. Learners vary in age, background, experience, knowledge, speed, available time, learning style, objective, motivation, and desired mastery. No single fixed sequence is assumed.

**Secondary — Administrator:** Manages users, learning activity, system configuration, resources, AI-generated paths where intervention is required, feedback, reports, usage/engagement, and safety/quality controls. Does not manually author every pathway — the system is primarily AI-driven, not a conventional course-authoring LMS.

## Main user journey

1. **Define the Goal** — Learner says what they want to learn, e.g. "I want to learn Excel for financial analysis."
2. **Clarify the Goal** — AI asks targeted questions (objective, current level, application, timeframe, available time) with minimal friction.
3. **Establish Starting Point** — Diagnostic via conversation / questions / short tasks to separate what they want to learn from what they already know.
4. **Define the Learning Outcome** — Broad goal translated to demonstrable outcome, e.g. "design, build, deploy and explain a functional responsive website."
5. **Generate the Learning Path** — Personalised sequence of concepts, skills, demonstrations, resources, examples, practice, challenges, assessments, projects.
6. **Learn → See → Practise** — AI explains, shows how (worked examples, demos, resources), learner performs guided → independent practice.
7. **Receive Feedback → Adapt** — AI evaluates (accuracy, completeness, reasoning, process), gives specific actionable feedback, then moves forward, remediates, simplifies, adds practice, or increases difficulty.
8. **Demonstrate Ability → Continue** — Learner completes a meaningful task as evidence of capability; system then recommends advanced / related skills and continued learning.

Instructional cycle: `LEARN → SEE → PRACTISE → PRODUCE → REFLECT → ASSESS → APPLY`

Dashboard answers: What am I learning? Where am I? What have I achieved? What should I do next?

## Current repo contents

- `SKILLPATH PRD.docx` — v1.0 Product Requirements Document (source of truth for MVP scope, architecture, data entities, metrics)
- `README.md` — this overview
- `Opencode Screenshot.JPG` — reference screenshot

See the PRD for full details: MVP scope (Section 15), out-of-scope features (Section 16), screens (Section 17), data model (Section 18), success metrics (Sections 19-20), and AI safety requirements (Section 21).

## Status

- Version: 1.0 — Product Definition / MVP Planning
- No implementation yet. No feature changes or builds in this commit — PRD capture only.
