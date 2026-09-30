// Minimum SkillPath prototype data model (see PRD.md).
// SQLite entities for Phase 3: User, LearningGoal, LearningPath, LearnerState.
// Practice Submission, Assessment, Skill graph and admin entities stay conceptual.

export type Step = 'goal' | 'clarify' | 'diagnostic' | 'path'

export interface Clarification {
  experience: string
  hoursPerWeek: string
}

export interface DiagnosticAnswer {
  questionId: string
  choiceId: string
}

export interface CoachResource {
  title: string
  source: string
  why: string
}

export interface PathStage {
  id: string
  title: string
  kind: 'Learn' | 'See' | 'Practise' | 'Produce'
  description: string
  practice: string
  minutes: number
  resources: CoachResource[]
}

export interface LearningPath {
  title: string
  outcome: string
  level: 'Starting out' | 'Developing'
  stages: PathStage[]
}

export interface ParsedGoal {
  subject: string
  desiredOutcome: string
  timeframe: string
}

export interface LearnerState {
  goalText: string
  clarification: Clarification | null
  answers: DiagnosticAnswer[]
  completedStageIds: string[]
  // Learner-confirmed structured goal (R2). Null when never parsed or
  // confirmed; old saves load as null and behave exactly as before.
  parsedGoal: ParsedGoal | null
}
