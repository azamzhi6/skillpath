// Thin local Express API for the SkillPath prototype (Phase 3).
// Four endpoints only. No auth, no cloud, no AI calls.
// Run: npm run dev:api   →   http://localhost:5174/api/health

import express from 'express'
import {
  clearAll,
  dbFilePath,
  loadSnapshot,
  saveSnapshot,
  type StoredSnapshot,
} from './db.ts'

const PORT = Number(process.env.PORT ?? 5174)
const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/state', (_req, res) => {
  res.json({ state: loadSnapshot() })
})

app.put('/api/state', (req, res) => {
  const body = req.body as { state?: unknown }
  const parsed = parseSnapshot(body.state)
  if (!parsed) {
    res.status(400).json({ error: 'Invalid state snapshot' })
    return
  }
  saveSnapshot(parsed)
  res.json({ ok: true })
})

app.delete('/api/state', (_req, res) => {
  clearAll()
  res.json({ ok: true })
})

function parseSnapshot(value: unknown): StoredSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const s = value as Record<string, unknown>
  if (typeof s.goalText !== 'string' || s.goalText.trim().length < 4) return null
  if (typeof s.template !== 'string') return null
  if (typeof s.experience !== 'string') return null
  if (typeof s.hoursPerWeek !== 'string') return null
  if (!Array.isArray(s.answers)) return null
  if (typeof s.score !== 'number') return null
  if (typeof s.level !== 'string') return null
  if (typeof s.pathTitle !== 'string') return null
  if (typeof s.pathOutcome !== 'string') return null
  if (typeof s.pathLevel !== 'string') return null
  if (!Array.isArray(s.stages)) return null
  if (
    !Array.isArray(s.completedStageIds) ||
    !s.completedStageIds.every((id) => typeof id === 'string')
  ) {
    return null
  }
  return {
    goalText: s.goalText,
    template: s.template,
    experience: s.experience,
    hoursPerWeek: s.hoursPerWeek,
    answers: s.answers as StoredSnapshot['answers'],
    score: s.score,
    level: s.level,
    pathTitle: s.pathTitle,
    pathOutcome: s.pathOutcome,
    pathLevel: s.pathLevel,
    stages: s.stages,
    completedStageIds: s.completedStageIds as string[],
  }
}

app.listen(PORT, 'localhost', () => {
  console.log(`SkillPath API listening on http://localhost:${PORT}`)
  console.log(`SQLite file: ${dbFilePath()}`)
})
