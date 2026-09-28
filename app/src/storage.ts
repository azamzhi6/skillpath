// Storage adapter seam. Prototype uses browser localStorage.
// Phase 3 will add a SQLite-backed adapter behind this same interface
// without changing the UI or mock coach logic.

import type { DiagnosticAnswer, LearnerState } from './types'

const KEY = 'skillpath.prototype.v1'

export interface StorageAdapter {
  load(): LearnerState | null
  save(state: LearnerState): void
  clear(): void
}

export const localStorageAdapter: StorageAdapter = {
  load() {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as LearnerState
      if (typeof parsed.goalText !== 'string') return null
      return {
        goalText: parsed.goalText,
        clarification: parsed.clarification ?? null,
        answers: Array.isArray(parsed.answers) ? parsed.answers : [],
        completedStageIds: Array.isArray(parsed.completedStageIds)
          ? parsed.completedStageIds
          : [],
      }
    } catch {
      return null
    }
  },
  save(state: LearnerState) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Prototype: ignore quota errors rather than breaking the flow.
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(KEY)
    } catch {
      // ignore
    }
  },
}

// ---- Thin-API persistence (Phase 3) ----
// Same journey snapshot the Express API stores in SQLite.
// The UI keeps working with LearnerState; only this module translates.

export interface ApiJourneySnapshot {
  goalText: string
  template: string
  experience: string
  hoursPerWeek: string
  answers: DiagnosticAnswer[]
  score: number
  level: string
  pathTitle: string
  pathOutcome: string
  pathLevel: string
  stages: unknown[]
  completedStageIds: string[]
}

async function requestJson(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(path, { ...init, signal: AbortSignal.timeout(5000) })
  } catch {
    throw new Error(`API unreachable for ${path}`)
  }
  if (!res.ok) throw new ApiHttpError(res.status, path)
  return (await res.json()) as unknown
}

export class ApiHttpError extends Error {
  status: number
  constructor(status: number, path: string) {
    super(`API ${status} for ${path}`)
    this.status = status
  }
}

/**
 * Network failures, timeouts and 5xx responses mean the API is unreachable.
 * 4xx responses mean the payload was rejected — the API is healthy, so the
 * app must stay in API mode (a short goal must never flip it offline).
 */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof ApiHttpError) return err.status >= 500
  return true
}

export async function apiHealth(): Promise<boolean> {
  try {
    const data = (await requestJson('/api/health')) as { ok?: unknown }
    return data.ok === true
  } catch {
    return false
  }
}

export async function fetchRemoteState(): Promise<LearnerState | null> {
  const data = (await requestJson('/api/state')) as {
    state?: ApiJourneySnapshot | null
  }
  const s = data.state
  if (!s || typeof s.goalText !== 'string' || s.goalText.trim() === '') {
    return null
  }
  return {
    goalText: s.goalText,
    clarification:
      typeof s.experience === 'string' && typeof s.hoursPerWeek === 'string'
        ? { experience: s.experience, hoursPerWeek: s.hoursPerWeek }
        : null,
    answers: Array.isArray(s.answers) ? s.answers.filter(isAnswer) : [],
    completedStageIds: Array.isArray(s.completedStageIds)
      ? s.completedStageIds.filter((id) => typeof id === 'string')
      : [],
  }
}

function isAnswer(value: unknown): value is DiagnosticAnswer {
  if (typeof value !== 'object' || value === null) return false
  const answer = value as Record<string, unknown>
  return (
    typeof answer.questionId === 'string' &&
    typeof answer.choiceId === 'string'
  )
}

export async function pushRemoteState(
  snapshot: ApiJourneySnapshot,
): Promise<void> {
  await requestJson('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: snapshot }),
  })
}

export async function clearRemoteState(): Promise<void> {
  await requestJson('/api/state', { method: 'DELETE' })
}

// ---- Phase 5: activity UI state (drafts live here, localStorage only) ----
// Draft responses are never sent to SQLite; only submitted work persists.

const ACTIVITY_KEY = 'skillpath.activity.v1'

export interface ActivityUi {
  stageId: string | null
  drafts: Record<string, string>
}

export function loadActivityUi(): ActivityUi {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY)
    if (!raw) return { stageId: null, drafts: {} }
    const parsed = JSON.parse(raw) as Partial<ActivityUi>
    const drafts: Record<string, string> = {}
    if (parsed.drafts && typeof parsed.drafts === 'object') {
      for (const [key, value] of Object.entries(parsed.drafts)) {
        if (typeof value === 'string') drafts[key] = value
      }
    }
    return {
      stageId: typeof parsed.stageId === 'string' ? parsed.stageId : null,
      drafts,
    }
  } catch {
    return { stageId: null, drafts: {} }
  }
}

export function saveActivityUi(ui: ActivityUi): void {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(ui))
  } catch {
    // ignore
  }
}

export function clearActivityUi(): void {
  try {
    window.localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    // ignore
  }
}

// ---- Phase 5: learning-loop persistence ----

export interface LearningSubmission {
  id: string
  stageId: string
  kind: string
  response: string
  attempt: number
}

export interface LearningFeedback {
  submissionId: string
  verdict: string
  strengths: string
  improvements: string
  nextAction: string
}

export interface CapabilityEvidence {
  id: string
  submissionId: string
  capability: string
  result: string
  evidence: string
}

export interface LearningBlock {
  submissions: LearningSubmission[]
  feedback: LearningFeedback[]
  evidence: CapabilityEvidence[]
}

export interface SubmissionResult {
  submissionId: string
  attempt: number
  verdict: string
  evidenceId: string | null
}

export async function fetchLearning(): Promise<LearningBlock> {
  const data = (await requestJson('/api/state')) as {
    learning?: LearningBlock | null
  }
  const block = data.learning
  if (!block || typeof block !== 'object') {
    return { submissions: [], feedback: [], evidence: [] }
  }
  return {
    submissions: Array.isArray(block.submissions) ? block.submissions : [],
    feedback: Array.isArray(block.feedback) ? block.feedback : [],
    evidence: Array.isArray(block.evidence) ? block.evidence : [],
  }
}

export interface NewSubmissionPayload {
  stageId: string
  kind: 'practice' | 'capability'
  response: string
  verdict: string
  strengths: string
  improvements: string
  nextAction: string
  evidence?: { capability: string; result: string; evidence: string } | null
}

export async function postSubmission(
  payload: NewSubmissionPayload,
): Promise<SubmissionResult> {
  const data = (await requestJson('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })) as {
    submission?: { id?: unknown; attempt?: unknown }
    feedback?: { verdict?: unknown }
    evidenceId?: unknown
  }
  if (
    !data.submission ||
    typeof data.submission.id !== 'string' ||
    typeof data.submission.attempt !== 'number' ||
    !data.feedback ||
    typeof data.feedback.verdict !== 'string'
  ) {
    throw new Error('API returned an invalid submission result')
  }
  return {
    submissionId: data.submission.id,
    attempt: data.submission.attempt,
    verdict: data.feedback.verdict,
    evidenceId:
      typeof data.evidenceId === 'string' ? data.evidenceId : null,
  }
}
