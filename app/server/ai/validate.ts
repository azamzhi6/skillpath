// Validators for AI Learn content (Phase 6B). Hand-rolled, mirroring the
// existing parseSnapshot style. No validation library.

export interface ValidLearnContent {
  explanation: string
  example: string
}

export const LEARN_EXPLANATION_MAX = 1200
export const LEARN_EXAMPLE_MAX = 800

export function validateLearnContent(value: unknown): ValidLearnContent | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.explanation !== 'string') return null
  if (typeof obj.example !== 'string') return null
  const explanation = obj.explanation.trim()
  const example = obj.example.trim()
  if (explanation === '' || example === '') return null
  if (
    explanation.length > LEARN_EXPLANATION_MAX ||
    example.length > LEARN_EXAMPLE_MAX
  ) {
    return null
  }
  return { explanation, example }
}

// Feedback-prose contract (R1): reworded strengths/improvements/nextAction.
// Lengths stay inside the existing feedback column budget (2000 chars).

export interface ValidFeedbackProse {
  strengths: string[]
  improvements: string[]
  nextAction: string
}

export const PROSE_ITEM_MAX = 400
export const PROSE_LIST_MIN = 1
export const PROSE_LIST_MAX = 3

function validProseList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false
  if (value.length < PROSE_LIST_MIN || value.length > PROSE_LIST_MAX) {
    return false
  }
  return value.every(
    (item) =>
      typeof item === 'string' &&
      item.trim() !== '' &&
      item.length <= PROSE_ITEM_MAX,
  )
}

export function validateFeedbackProse(value: unknown): ValidFeedbackProse | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (!validProseList(obj.strengths)) return null
  if (!validProseList(obj.improvements)) return null
  if (
    typeof obj.nextAction !== 'string' ||
    obj.nextAction.trim() === '' ||
    obj.nextAction.length > PROSE_ITEM_MAX
  ) {
    return null
  }
  return {
    strengths: (obj.strengths as string[]).map((s) => s.trim()),
    improvements: (obj.improvements as string[]).map((s) => s.trim()),
    nextAction: (obj.nextAction as string).trim(),
  }
}
