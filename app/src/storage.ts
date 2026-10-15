// Storage adapter seam. Prototype uses browser localStorage.
// Phase 3 will add a SQLite-backed adapter behind this same interface
// without changing the UI or mock coach logic.

import type {
  DiagnosticAnswer,
  LearnerState,
  ParsedGoal,
} from './types'

const KEY = 'skillpath.prototype.v1'

function isParsedGoal(value: unknown): value is ParsedGoal {
  if (typeof value !== 'object' || value === null) return false
  const g = value as Record<string, unknown>
  return (
    typeof g.subject === 'string' &&
    typeof g.desiredOutcome === 'string' &&
    typeof g.timeframe === 'string'
  )
}

function readParsedGoal(value: unknown): ParsedGoal | null {
  return isParsedGoal(value) ? value : null
}

// Per-identity browser cache. The legacy key stays the demo store, so
// existing demo caches keep working; signed-in learners get isolated keys.
// Switching accounts therefore cannot expose one learner's cached journey
// to another on a shared device.
export type StoreIdentity = { kind: 'demo' } | { kind: 'user'; id: string }

function journeyKey(identity: StoreIdentity): string {
  return journeyCacheKey(identity)
}

export function journeyCacheKey(identity: StoreIdentity): string {
  return identity.kind === 'demo' ? KEY : `${KEY}.u.${identity.id}`
}

export function loadJourneyCache(identity: StoreIdentity): LearnerState | null {
  try {
    const raw = window.localStorage.getItem(journeyKey(identity))
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
      parsedGoal: readParsedGoal(
        (parsed as { parsedGoal?: unknown }).parsedGoal,
      ),
    }
  } catch {
    return null
  }
}

export function saveJourneyCache(identity: StoreIdentity, state: LearnerState): void {
  try {
    window.localStorage.setItem(journeyKey(identity), JSON.stringify(state))
  } catch {
    // Prototype: ignore quota errors rather than breaking the flow.
  }
}

export function clearJourneyCache(identity: StoreIdentity): void {
  try {
    window.localStorage.removeItem(journeyKey(identity))
  } catch {
    // ignore
  }
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
  parsedGoal?: ParsedGoal | null
}

export interface GoalParseResult {
  source: 'ai' | 'mock'
  parsed: ParsedGoal | null
}

async function requestJson(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new Error(`API unreachable for ${path}`)
  }
  if (!res.ok) throw await apiError(res, path)
  return (await res.json()) as unknown
}

async function apiError(res: Response, path: string): Promise<ApiHttpError> {
  let message: string | undefined
  try {
    const data = (await res.json()) as { error?: unknown }
    if (typeof data.error === 'string' && data.error !== '') message = data.error
  } catch {
    // Non-JSON error body: fall back to the status-based message.
  }
  return new ApiHttpError(res.status, path, message)
}

export class ApiHttpError extends Error {
  status: number
  constructor(status: number, path: string, message?: string) {
    super(message ?? `API ${status} for ${path}`)
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
    parsedGoal: readParsedGoal(s.parsedGoal),
  }
}

export async function fetchGoalParse(
  goalText: string,
): Promise<GoalParseResult> {
  try {
    const data = (await requestJson('/api/goal-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalText }),
    })) as { source?: unknown; parsed?: unknown }
    if (data.source === 'ai' && isParsedGoal(data.parsed)) {
      return { source: 'ai', parsed: data.parsed }
    }
  } catch {
    // Fall through to mock below.
  }
  return { source: 'mock', parsed: null }
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
): Promise<'demo' | 'authenticated'> {
  const data = (await requestJson('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: snapshot }),
  })) as { scope?: unknown }
  return data.scope === 'authenticated' ? 'authenticated' : 'demo'
}

export async function clearRemoteState(): Promise<void> {
  await requestJson('/api/state', { method: 'DELETE' })
}

// ---- Phase 6B: AI Learn content ----
// Never throws: any failure means the UI must use deterministic content.

export interface LearnContentRequest {
  goalText: string
  outcome: string
  stageTitle: string
  stageKind: string
  stageDescription: string
  practiceTask: string
  level: string
}

export interface LearnContentResult {
  source: 'ai' | 'mock'
  explanation?: string
  example?: string
}

export async function fetchLearnContent(
  input: LearnContentRequest,
): Promise<LearnContentResult> {
  try {
    const data = (await requestJson('/api/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })) as {
      source?: unknown
      explanation?: unknown
      example?: unknown
    }
    if (
      data.source === 'ai' &&
      typeof data.explanation === 'string' &&
      data.explanation.trim() !== '' &&
      data.explanation.length <= 1200 &&
      typeof data.example === 'string' &&
      data.example.trim() !== '' &&
      data.example.length <= 800
    ) {
      return {
        source: 'ai',
        explanation: data.explanation,
        example: data.example,
      }
    }
  } catch {
    // Fall through to mock below.
  }
  return { source: 'mock' }
}

// ---- Phase 5: activity UI state (drafts live here, localStorage only) ----
// Draft responses are never sent to SQLite; only submitted work persists.

const ACTIVITY_KEY = 'skillpath.activity.v1'

export interface ActivityUi {
  stageId: string | null
  drafts: Record<string, string>
}

function activityKey(identity: StoreIdentity): string {
  return activityCacheKey(identity)
}

export function activityCacheKey(identity: StoreIdentity): string {
  return identity.kind === 'demo' ? ACTIVITY_KEY : `${ACTIVITY_KEY}.u.${identity.id}`
}

export function loadActivityUi(identity: StoreIdentity): ActivityUi {
  try {
    const raw = window.localStorage.getItem(activityKey(identity))
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

export function saveActivityUi(identity: StoreIdentity, ui: ActivityUi): void {
  try {
    window.localStorage.setItem(activityKey(identity), JSON.stringify(ui))
  } catch {
    // ignore
  }
}

export function clearActivityUi(identity: StoreIdentity): void {
  try {
    window.localStorage.removeItem(activityKey(identity))
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
  // Present for rows stored after R1; older rows behave as 'mock'.
  proseSource?: string
}

export interface CapabilityEvidence {
  id: string
  submissionId: string
  capability: string
  result: string
  evidence: string
}

export interface CriterionOutcome {
  criterionId: string
  met: boolean
}

export interface LearningMastery {
  template: string
  stageId: string
  criterionId: string
  attempts: number
  passes: number
  failures: number
  consecutiveFailures: number
  lastResult: string
  masteryStatus: string
}

export interface LearningBlock {
  submissions: LearningSubmission[]
  feedback: LearningFeedback[]
  evidence: CapabilityEvidence[]
  mastery: LearningMastery[]
}

export interface SubmissionResult {
  submissionId: string
  attempt: number
  verdict: string
  strengths: string
  improvements: string
  nextAction: string
  proseSource: string
  mastery: LearningMastery[]
  evidenceId: string | null
}

function isMasteryRow(value: unknown): value is LearningMastery {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.template === 'string' &&
    typeof row.stageId === 'string' &&
    typeof row.criterionId === 'string' &&
    typeof row.attempts === 'number' &&
    typeof row.passes === 'number' &&
    typeof row.failures === 'number' &&
    typeof row.consecutiveFailures === 'number' &&
    typeof row.lastResult === 'string' &&
    typeof row.masteryStatus === 'string'
  )
}

export async function fetchLearning(): Promise<LearningBlock> {
  const data = (await requestJson('/api/state')) as {
    learning?: LearningBlock | null
  }
  const block = data.learning
  if (!block || typeof block !== 'object') {
    return { submissions: [], feedback: [], evidence: [], mastery: [] }
  }
  return {
    submissions: Array.isArray(block.submissions) ? block.submissions : [],
    feedback: Array.isArray(block.feedback) ? block.feedback : [],
    evidence: Array.isArray(block.evidence) ? block.evidence : [],
    mastery: Array.isArray(block.mastery)
      ? block.mastery.filter(isMasteryRow)
      : [],
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
  criteria?: CriterionOutcome[]
  template?: string
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
    feedback?: {
      verdict?: unknown
      strengths?: unknown
      improvements?: unknown
      nextAction?: unknown
      proseSource?: unknown
    }
    mastery?: unknown
    evidenceId?: unknown
  }
  if (
    !data.submission ||
    typeof data.submission.id !== 'string' ||
    typeof data.submission.attempt !== 'number' ||
    !data.feedback ||
    typeof data.feedback.verdict !== 'string' ||
    typeof data.feedback.strengths !== 'string' ||
    typeof data.feedback.improvements !== 'string' ||
    typeof data.feedback.nextAction !== 'string'
  ) {
    throw new Error('API returned an invalid submission result')
  }
  return {
    submissionId: data.submission.id,
    attempt: data.submission.attempt,
    verdict: data.feedback.verdict,
    strengths: data.feedback.strengths,
    improvements: data.feedback.improvements,
    nextAction: data.feedback.nextAction,
    proseSource:
      data.feedback.proseSource === 'ai' ? 'ai' : 'mock',
    mastery: Array.isArray(data.mastery)
      ? data.mastery.filter(isMasteryRow)
      : [],
    evidenceId:
      typeof data.evidenceId === 'string' ? data.evidenceId : null,
  }
}

// ---- Session (Phase 1, Task 2) ----
// Identity always comes from the server session cookie, which requestJson
// sends via credentials: 'same-origin'. Error text comes from the server
// JSON body through ApiHttpError.

export interface SessionUser {
  id: string
  email: string
  role: string
}

export interface SessionState {
  authenticated: boolean
  demo: boolean
  user: SessionUser | null
}

function toSessionUser(value: unknown): SessionUser | null {
  if (typeof value !== 'object' || value === null) return null
  const user = value as Record<string, unknown>
  if (
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    typeof user.role !== 'string'
  ) {
    return null
  }
  return { id: user.id, email: user.email, role: user.role }
}

export async function fetchSession(): Promise<SessionState> {
  try {
    const data = (await requestJson('/api/auth/me')) as {
      authenticated?: unknown
      demo?: unknown
      user?: unknown
    }
    const user = data.authenticated === true ? toSessionUser(data.user) : null
    if (data.authenticated === true && !user) throw new Error('Invalid session response')
    return { authenticated: user !== null, demo: data.demo === true, user }
  } catch {
    return { authenticated: false, demo: false, user: null }
  }
}

export async function fetchDemoSession(): Promise<SessionState> {
  const data = (await requestJson('/api/auth/demo', { method: 'POST' })) as {
    authenticated?: unknown
    demo?: unknown
    user?: unknown
  }
  const user = data.authenticated === true ? toSessionUser(data.user) : null
  if (!user) throw new Error('Invalid demo session response')
  return { authenticated: true, demo: data.demo === true, user }
}

export async function registerAccount(email: string, password: string): Promise<SessionUser> {
  const data = (await requestJson('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as { user?: unknown }
  const user = toSessionUser(data.user)
  if (!user) throw new Error('Invalid registration response')
  return user
}

export async function loginAccount(email: string, password: string): Promise<SessionUser> {
  const data = (await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as { user?: unknown }
  const user = toSessionUser(data.user)
  if (!user) throw new Error('Invalid login response')
  return user
}

export async function logoutAccount(): Promise<void> {
  await requestJson('/api/auth/logout', { method: 'POST' })
}
