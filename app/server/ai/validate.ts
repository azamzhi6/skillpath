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
