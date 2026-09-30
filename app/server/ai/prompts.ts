// Learn-prompt v1 (Phase 6B). Small, versioned, reviewable in diffs.
// Context is minimal: goal + outcome + current stage only.

export const LEARN_PROMPT_VERSION = 'v1'

export interface LearnPromptInput {
  goalText: string
  outcome: string
  stageTitle: string
  stageKind: string
  stageDescription: string
  practiceTask: string
  level: string
}

export const LEARN_SYSTEM_INSTRUCTIONS = [
  'You are a SkillPath learning coach. Teach toward real-world capability, not course completion.',
  'Use plain professional language for an adult learner.',
  'Ground the explanation in the learner goal provided. Do not invent unrelated topics.',
  'Never invent resources, URLs, people, credentials, or citations.',
  'If something is uncertain or depends on context, say so briefly.',
  'Return ONLY the required JSON object, no other text.',
].join(' ')

export function buildLearnMessages(input: LearnPromptInput): {
  system: string
  user: string
} {
  return {
    system: LEARN_SYSTEM_INSTRUCTIONS,
    user: [
      `Learner goal: ${input.goalText}`,
      `Intended outcome: ${input.outcome}`,
      `Current stage: ${input.stageTitle} (${input.stageKind})`,
      `Stage description: ${input.stageDescription}`,
      `Practice task: ${input.practiceTask}`,
      `Learner level: ${input.level}`,
      'Write a concise explanation of this stage and one practical worked example.',
      'Respond with JSON only: {"explanation": "...", "example": "..."}',
    ].join('\n'),
  }
}

// Feedback-prose prompt v1 (R1). A rewrite task, NOT an evaluation: the
// deterministic verdict and judgments are supplied as meaning anchors the
// model must preserve, never second-guess.

export const FEEDBACK_PROMPT_VERSION = 'v1'

export interface FeedbackPromptInput {
  goalText: string
  stageTitle: string
  stageKind: string
  response: string
  verdict: string
  strengths: string[]
  improvements: string[]
  nextAction: string
  attempt: number
}

export const FEEDBACK_SYSTEM_INSTRUCTIONS = [
  'You are a SkillPath learning coach rewriting feedback for a learner.',
  'You are given the official verdict and feedback points. Preserve the meaning of every supplied strength, improvement and next action exactly.',
  'Do not introduce a new judgment. Do not contradict the verdict. Do not invent claims about what the learner did. Do not add new requirements. Do not change any remediation logic.',
  'Use plain professional language for an adult learner.',
  'Return ONLY the required JSON object, no other text.',
].join(' ')

export function buildFeedbackMessages(input: FeedbackPromptInput): {
  system: string
  user: string
} {
  return {
    system: FEEDBACK_SYSTEM_INSTRUCTIONS,
    user: [
      `Learner goal: ${input.goalText}`,
      `Stage: ${input.stageTitle} (${input.stageKind}), attempt ${input.attempt}`,
      `Official verdict (fixed, do not change): ${input.verdict}`,
      `Learner response: ${input.response}`,
      `Strengths to preserve: ${input.strengths.join(' | ')}`,
      `Improvements to preserve: ${input.improvements.join(' | ')}`,
      `Next action to preserve: ${input.nextAction}`,
      'Reword the strengths, improvements and next action in clear learner-facing prose.',
      'Respond with JSON only: {"strengths": ["..."], "improvements": ["..."], "nextAction": "..."}',
    ].join('\n'),
  }
}

// Goal-parse prompt v1 (R2). Extraction only, never assessment: pull the
// subject, desired outcome and timeframe reasonably present in the learner's
// own words. Never infer skill level, proficiency, readiness or a timeframe
// that is not stated. Use "" when a field cannot be extracted.

export const GOAL_PARSE_PROMPT_VERSION = 'v1'

export interface GoalParsePromptInput {
  goalText: string
}

export const GOAL_PARSE_SYSTEM_INSTRUCTIONS = [
  'You extract structured information from a learner-stated learning goal.',
  'Extract only information reasonably present in the text. Preserve the intended meaning.',
  'Do not invent missing facts. Do not infer skill level, proficiency, diagnostic level, readiness, performance or assessment status.',
  'Do not infer a timeframe that is not stated. Do not make the outcome more ambitious than stated. Do not convert vague language into a specific measurable target unless that target is present in the text.',
  'Use "" for any field that cannot be extracted. Do not make assessment or progression decisions.',
  'Return ONLY the required JSON object, no other text.',
].join(' ')

export function buildGoalParseMessages(input: GoalParsePromptInput): {
  system: string
  user: string
} {
  return {
    system: GOAL_PARSE_SYSTEM_INSTRUCTIONS,
    user: [
      `Learner goal: ${input.goalText}`,
      'Extract the subject, the desired outcome in the learner’s own terms, and the timeframe if one is stated.',
      'Respond with JSON only: {"subject": "...", "desiredOutcome": "...", "timeframe": "..."}',
    ].join('\n'),
  }
}
