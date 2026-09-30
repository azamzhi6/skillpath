// AI provider contract (Phase 6A). The application depends on this
// interface, never on a specific vendor. Swapping providers means adding
// one adapter file, not rewriting learning logic.

import type { FeedbackPromptInput, LearnPromptInput } from './prompts.ts'
import type { ValidFeedbackProse, ValidLearnContent } from './validate.ts'

export interface LearnRequest {
  input: LearnPromptInput
}

export interface FeedbackProseRequest {
  input: FeedbackPromptInput
}

export interface AiProvider {
  /** Stable name for logs and diagnostics (never a secret). */
  readonly name: string
  /** False when the provider cannot serve (e.g. no API key configured). */
  isConfigured(): boolean
  /**
   * Generate Learn content. Returns validated content, or null when the
   * provider is unavailable, fails, times out, or returns unusable output.
   * Must never throw for provider-side problems and never log secrets.
   */
  generateLearn(request: LearnRequest): Promise<ValidLearnContent | null>
  /**
   * Reword deterministic feedback prose. The verdict and all judgments stay
   * deterministic: this only rewrites the supplied strengths, improvements
   * and next action. Returns null on any provider-side problem.
   */
  generateFeedbackProse(
    request: FeedbackProseRequest,
  ): Promise<ValidFeedbackProse | null>
}
