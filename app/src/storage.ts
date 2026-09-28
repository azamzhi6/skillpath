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
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`)
  return (await res.json()) as unknown
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
    answers: Array.isArray(s.answers) ? s.answers : [],
    completedStageIds: Array.isArray(s.completedStageIds)
      ? s.completedStageIds.filter((id) => typeof id === 'string')
      : [],
  }
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
