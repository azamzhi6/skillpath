// Thin local Express API for the SkillPath prototype (Phase 3).
// Four endpoints only. No auth, no cloud, no AI calls.
// Run: npm run dev:api   →   http://localhost:5174/api/health

import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { loadLocalEnv } from './ai/env.ts'
import { GroqProvider, groqConfigFromEnv } from './ai/groq.ts'
import type { AiProvider } from './ai/provider.ts'
import {
  clearAll,
  dbFilePath,
  journeyExists,
  loadGoalText,
  loadLearning,
  loadSnapshot,
  loadStageInfo,
  saveEvidence,
  saveFeedback,
  saveSnapshot,
  saveSubmission,
  type NewSubmission,
  type StoredSnapshot,
} from './db.ts'

loadLocalEnv()

const PORT = Number(process.env.PORT ?? 5174)
const app = express()
app.use(express.json({ limit: '256kb' }))

const groqConfig = groqConfigFromEnv()
const learnProvider: AiProvider | null = groqConfig
  ? new GroqProvider(groqConfig)
  : null
console.log(
  `SkillPath AI Learn provider: ${learnProvider ? `groq (model ${groqConfig?.model})` : 'mock fallback (no GROQ_API_KEY)'}`,
)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/state', (_req, res) => {
  res.json({ state: loadSnapshot(), learning: loadLearning() })
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

// R2: AI goal parsing. Interpretation only — raw-goal validation stays
// deterministic and the parsed fields never gate progression. Always 200
// with { source, parsed }; failures yield { source: 'mock', parsed: null }.
app.post('/api/goal-parse', async (req, res) => {
  const body = req.body as { goalText?: unknown }
  if (
    typeof body.goalText !== 'string' ||
    body.goalText.trim().length < 4 ||
    body.goalText.length > 500
  ) {
    res.status(400).json({ error: 'Invalid goal text' })
    return
  }
  if (learnProvider && learnProvider.isConfigured()) {
    try {
      const parsed = await learnProvider.generateGoalParse({
        input: { goalText: body.goalText },
      })
      if (parsed) {
        res.json({ source: 'ai', parsed })
        return
      }
    } catch {
      // Fall through to the mock source below.
    }
  }
  res.json({ source: 'mock', parsed: null })
})

// Phase 6B: AI Learn content. Always 200 with { source, explanation?, example? }.
// source 'mock' means the frontend must use its deterministic stageLearn() text.
app.post('/api/learn', async (req, res) => {
  const input = parseLearnInput(req.body)
  if (!input) {
    res.status(400).json({ error: 'Invalid learn request' })
    return
  }
  if (learnProvider && learnProvider.isConfigured()) {
    try {
      const content = await learnProvider.generateLearn({ input })
      if (content) {
        res.json({
          source: 'ai',
          explanation: content.explanation,
          example: content.example,
        })
        return
      }
    } catch {
      // Fall through to the mock source below.
    }
  }
  res.json({ source: 'mock' })
})

const STAGE_KINDS = ['Learn', 'See', 'Practise', 'Produce'] as const

function parseLearnInput(value: unknown): {
  goalText: string
  outcome: string
  stageTitle: string
  stageKind: string
  stageDescription: string
  practiceTask: string
  level: string
} | null {
  if (typeof value !== 'object' || value === null) return null
  const s = value as Record<string, unknown>
  const fields = [
    'goalText',
    'outcome',
    'stageTitle',
    'stageKind',
    'stageDescription',
    'practiceTask',
    'level',
  ] as const
  for (const field of fields) {
    if (typeof s[field] !== 'string' || (s[field] as string).trim() === '') {
      return null
    }
    if ((s[field] as string).length > 2000) return null
  }
  if (!(STAGE_KINDS as readonly string[]).includes(s.stageKind as string)) {
    return null
  }
  return {
    goalText: s.goalText as string,
    outcome: s.outcome as string,
    stageTitle: s.stageTitle as string,
    stageKind: s.stageKind as string,
    stageDescription: s.stageDescription as string,
    practiceTask: s.practiceTask as string,
    level: s.level as string,
  }
}

const SUBMISSION_KINDS = ['practice', 'capability'] as const
const SUBMISSION_VERDICTS = ['satisfactory', 'retry', 'remedial'] as const

app.post('/api/submissions', async (req, res) => {
  try {
    if (!journeyExists()) {
      res.status(400).json({ error: 'No active learning journey' })
      return
    }
    const parsed = parseSubmission(req.body)
    if (!parsed) {
      res.status(400).json({ error: 'Invalid submission' })
      return
    }
    const { id, attempt } = saveSubmission(parsed.submission)
    // Deterministic prose is the default. AI may only reword it; the
    // verdict and all judgments stay exactly as the client evaluated them.
    let strengths = parsed.submission.strengths
    let improvements = parsed.submission.improvements
    let nextAction = parsed.submission.nextAction
    let proseSource: 'ai' | 'mock' = 'mock'
    if (learnProvider && learnProvider.isConfigured()) {
      try {
        const stage = loadStageInfo(parsed.submission.stageId)
        const prose = await learnProvider.generateFeedbackProse({
          input: {
            goalText: loadGoalText(),
            stageTitle: stage?.title ?? parsed.submission.stageId,
            stageKind: stage?.kind ?? parsed.submission.kind,
            response: parsed.submission.response,
            verdict: parsed.submission.verdict,
            strengths: decodeList(parsed.submission.strengths),
            improvements: decodeList(parsed.submission.improvements),
            nextAction: parsed.submission.nextAction,
            attempt,
          },
        })
        if (prose) {
          strengths = JSON.stringify(prose.strengths)
          improvements = JSON.stringify(prose.improvements)
          nextAction = prose.nextAction
          proseSource = 'ai'
        }
      } catch {
        // Mock fallback: deterministic prose below is unchanged.
      }
    }
    saveFeedback(
      id,
      parsed.submission.verdict,
      strengths,
      improvements,
      nextAction,
      proseSource,
    )
    let evidenceId: string | null = null
    if (parsed.evidence) {
      evidenceId = saveEvidence(
        id,
        parsed.evidence.capability,
        parsed.evidence.result,
        parsed.evidence.evidence,
      )
    }
    res.json({
      submission: { id, attempt },
      feedback: {
        verdict: parsed.submission.verdict,
        strengths,
        improvements,
        nextAction,
        proseSource,
      },
      evidenceId,
    })
  } catch {
    res.status(500).json({ error: 'Could not save submission' })
  }
})

function decodeList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // fall through to plain-text fallback
  }
  return value ? [value] : []
}

interface ParsedSubmission {
  submission: NewSubmission
  evidence: { capability: string; result: string; evidence: string } | null
}

function isNonEmptyString(value: unknown, maxLen: number): value is string {
  return (
    typeof value === 'string' && value.length >= 1 && value.length <= maxLen
  )
}

function parseSubmission(value: unknown): ParsedSubmission | null {
  if (typeof value !== 'object' || value === null) return null
  const s = value as Record<string, unknown>
  if (typeof s.stageId !== 'string' || s.stageId.trim() === '') return null
  if (
    typeof s.kind !== 'string' ||
    !(SUBMISSION_KINDS as readonly string[]).includes(s.kind)
  ) {
    return null
  }
  if (!isNonEmptyString(s.response, 4000)) return null
  if (
    typeof s.verdict !== 'string' ||
    !(SUBMISSION_VERDICTS as readonly string[]).includes(s.verdict)
  ) {
    return null
  }
  if (
    typeof s.strengths !== 'string' ||
    typeof s.improvements !== 'string' ||
    typeof s.nextAction !== 'string' ||
    s.strengths.length > 2000 ||
    s.improvements.length > 2000 ||
    s.nextAction.length > 2000
  ) {
    return null
  }
  let evidence: ParsedSubmission['evidence'] = null
  if (s.evidence !== undefined && s.evidence !== null) {
    if (typeof s.evidence !== 'object') return null
    const e = s.evidence as Record<string, unknown>
    if (
      !isNonEmptyString(e.capability, 500) ||
      !isNonEmptyString(e.result, 100) ||
      !isNonEmptyString(e.evidence, 2000)
    ) {
      return null
    }
    evidence = {
      capability: e.capability,
      result: e.result,
      evidence: e.evidence,
    }
  }
  return {
    submission: {
      stageId: s.stageId,
      kind: s.kind as NewSubmission['kind'],
      response: s.response as string,
      verdict: s.verdict as NewSubmission['verdict'],
      strengths: s.strengths as string,
      improvements: s.improvements as string,
      nextAction: s.nextAction as string,
    },
    evidence,
  }
}

// Malformed JSON should answer JSON, not an HTML error page.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Invalid JSON' })
    return
  }
  next(err)
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
  let parsedGoal: StoredSnapshot['parsedGoal'] = null
  if (s.parsedGoal !== undefined && s.parsedGoal !== null) {
    if (typeof s.parsedGoal !== 'object') return null
    const g = s.parsedGoal as Record<string, unknown>
    if (
      typeof g.subject !== 'string' ||
      g.subject.length > 120 ||
      typeof g.desiredOutcome !== 'string' ||
      g.desiredOutcome.length > 300 ||
      typeof g.timeframe !== 'string' ||
      !['2 weeks', '1 month', '3 months', 'flexible', ''].includes(g.timeframe)
    ) {
      return null
    }
    parsedGoal = {
      subject: g.subject,
      desiredOutcome: g.desiredOutcome,
      timeframe: g.timeframe,
    }
  }
  return {
    goalText: s.goalText,
    template: s.template,
    experience: s.experience,
    hoursPerWeek: s.hoursPerWeek,
    parsedGoal,
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
