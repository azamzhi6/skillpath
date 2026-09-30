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
