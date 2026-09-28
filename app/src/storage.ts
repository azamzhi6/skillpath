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
