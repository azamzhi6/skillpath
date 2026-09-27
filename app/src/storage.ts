// Storage adapter seam. Prototype uses browser localStorage.
// Phase 3 will add a SQLite-backed adapter behind this same interface
// without changing the UI or mock coach logic.

import type { LearnerState } from './types'

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
