import { useEffect, useMemo, useState } from 'react'
import {
  capabilityCriteria,
  capabilityTask,
  clarifySummary,
  detectTemplate,
  diagnosticQuestions,
  diagnosticScore,
  evaluateCapability,
  evaluatePractice,
  generatePath,
  nextStage,
  stageAssessment,
  stageLearn,
} from './mockCoach'
import {
  apiHealth,
  clearActivityUi,
  clearRemoteState,
  fetchGoalParse,
  fetchLearnContent,
  fetchLearning,
  fetchRemoteState,
  isOfflineError,
  loadActivityUi,
  localStorageAdapter,
  postSubmission,
  pushRemoteState,
  saveActivityUi,
  type ApiJourneySnapshot,
  type CapabilityEvidence,
  type LearningFeedback,
  type LearningSubmission,
} from './storage'
import type {
  Clarification,
  DiagnosticAnswer,
  LearnerState,
  ParsedGoal,
  PathStage,
  Step,
} from './types'

const EXPERIENCE_OPTIONS = [
  'Complete beginner',
  'Tried it before',
  'Comfortable with basics',
]

const HOURS_OPTIONS = ['2 hours', '4 hours', '6+ hours']

type PersistenceMode = 'checking' | 'api' | 'offline'

type ActivityView = 'learn' | 'practice' | 'feedback'

interface AiLearnEntry {
  status: 'loading' | 'ai' | 'mock'
  explanation?: string
  example?: string
}

function encodeList(items: string[]): string {
  return JSON.stringify(items)
}

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

// Translate UI state into the snapshot shape stored by the thin API/SQLite.
function buildSnapshot(state: LearnerState): ApiJourneySnapshot {
  const template = detectTemplate(state.goalText)
  const { score, level } = diagnosticScore(template, state.answers)
  const hasPath = state.clarification !== null && state.answers.length > 0
  const path = hasPath
    ? generatePath(
        state.goalText,
        state.clarification ?? { experience: '', hoursPerWeek: '' },
        state.answers,
      )
    : null
  return {
    goalText: state.goalText,
    template,
    experience: state.clarification?.experience ?? '',
    hoursPerWeek: state.clarification?.hoursPerWeek ?? '',
    answers: state.answers,
    score,
    level,
    pathTitle: path ? path.title : '',
    pathOutcome: path ? path.outcome : '',
    pathLevel: path ? path.level : level,
    stages: path ? path.stages : [],
    completedStageIds: state.completedStageIds,
    parsedGoal: state.parsedGoal,
  }
}

const inputClass =
  'w-full rounded-lg border-2 border-line bg-white px-3.5 py-3 text-[17px] font-medium leading-normal text-ink placeholder:text-[#8A9494] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint'

const selectClass =
  'w-full rounded-lg border-2 border-line bg-white px-3.5 py-2.5 text-base text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint'

export default function App() {
  const [step, setStep] = useState<Step>('goal')
  const [goalText, setGoalText] = useState('')
  const [goalError, setGoalError] = useState<string | null>(null)
  const [clarification, setClarification] = useState<Clarification>({
    experience: EXPERIENCE_OPTIONS[0],
    hoursPerWeek: HOURS_OPTIONS[1],
  })
  const [answers, setAnswers] = useState<DiagnosticAnswer[]>([])
  const [completedStageIds, setCompletedStageIds] = useState<string[]>([])
  const [restored, setRestored] = useState(false)
  // R2: learner-confirmed structured goal (null = raw text only, as before).
  const [parsedGoal, setParsedGoal] = useState<ParsedGoal | null>(null)
  const [parseSuggestion, setParseSuggestion] = useState<ParsedGoal | null>(null)
  const [parsingGoal, setParsingGoal] = useState(false)
  const [parseConfirmed, setParseConfirmed] = useState(false)
  const [editParsed, setEditParsed] = useState<ParsedGoal | null>(null)
  const [apiMode, setApiMode] = useState<PersistenceMode>('checking')
  const [saving, setSaving] = useState(false)
  // Phase 5 learning loop: selected activity, draft (local only), submissions.
  const [activityStageId, setActivityStageId] = useState<string | null>(null)
  const [activityView, setActivityView] = useState<ActivityView>('learn')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [subs, setSubs] = useState<LearningSubmission[]>([])
  const [fbMap, setFbMap] = useState<Record<string, LearningFeedback>>({})
  const [evidenceList, setEvidenceList] = useState<CapabilityEvidence[]>([])
  // Phase 6B: per-stage AI Learn content. Absent/mock entries render the
  // existing deterministic stageLearn() text; only 'ai' entries are labelled.
  const [aiLearn, setAiLearn] = useState<Record<string, AiLearnEntry>>({})

  function applyState(saved: LearnerState) {
    setGoalText(saved.goalText)
    if (saved.clarification) setClarification(saved.clarification)
    setAnswers(saved.answers)
    setCompletedStageIds(saved.completedStageIds)
    setParsedGoal(saved.parsedGoal ?? null)
    setParseSuggestion(null)
    setEditParsed(null)
    setParseConfirmed(saved.parsedGoal !== null && saved.parsedGoal !== undefined)
    setParsingGoal(false)
    // Only resume at the path step when the diagnostic is fully answered;
    // a partial diagnostic (e.g. after a mid-step refresh) resumes at the
    // diagnostic step with answers preserved.
    const needed = diagnosticQuestions(
      detectTemplate(saved.goalText),
    ).length
    if (
      saved.clarification &&
      needed > 0 &&
      saved.answers.length >= needed
    ) {
      setStep('path')
    } else if (saved.clarification) {
      setStep('diagnostic')
    }
    setRestored(true)
  }

  // Restore once on load: SQLite/API first, one-time localStorage migration,
  // offline local copy when the API is unreachable.
  useEffect(() => {
    let cancelled = false
    async function init() {
      const local = localStorageAdapter.load()
      const healthy = await apiHealth()
      if (cancelled) return
      if (healthy) {
        setApiMode('api')
        try {
          const remote = await fetchRemoteState()
          if (cancelled) return
          if (remote && remote.goalText.trim()) {
            applyState(remote)
            return
          }
          if (local && local.goalText.trim()) {
            applyState(local)
            await pushRemoteState(buildSnapshot(local)).catch((err: unknown) => {
              if (!cancelled && isOfflineError(err)) setApiMode('offline')
            })
            return
          }
        } catch (err: unknown) {
          if (!cancelled && isOfflineError(err)) setApiMode('offline')
        }
        if (!cancelled) {
          try {
            const block = await fetchLearning()
            if (cancelled) return
            setSubs(block.submissions)
            const map: Record<string, LearningFeedback> = {}
            for (const f of block.feedback) map[f.submissionId] = f
            setFbMap(map)
            setEvidenceList(block.evidence)
          } catch {
            // Learning history is best-effort; the journey snapshot above
            // is what the path view needs.
          }
        }
      } else {
        setApiMode('offline')
      }
      if (cancelled) return
      if (local && local.goalText.trim()) applyState(local)
      const activity = loadActivityUi()
      if (!cancelled) {
        if (activity.stageId) {
          setActivityStageId(activity.stageId)
          setActivityView('learn')
        }
        if (activity.drafts) setDrafts(activity.drafts)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist progress: always mirror locally; write through to SQLite/API
  // while it is healthy (local copy doubles as the offline fallback).
  // Short goals (<4 chars) stay local-only: the API rejects them, and a
  // rejection must never flip a healthy API into offline mode.
  useEffect(() => {
    if (!restored && goalText.trim() === '') return
    const state: LearnerState = {
      goalText,
      clarification: step === 'goal' ? null : clarification,
      answers,
      completedStageIds,
      parsedGoal,
    }
    if (goalText.trim() === '') return
    localStorageAdapter.save(state)
    if (apiMode === 'api' && goalText.trim().length >= 4) {
      setSaving(true)
      pushRemoteState(buildSnapshot(state))
        .then(() => setSaving(false))
        .catch((err: unknown) => {
          setSaving(false)
          if (isOfflineError(err)) setApiMode('offline')
        })
    }
  }, [goalText, clarification, answers, completedStageIds, step, restored, apiMode, parsedGoal])

  // Activity UI (selected stage + per-stage drafts) persists in localStorage
  // only — drafts are never sent to SQLite; only submitted work persists.
  useEffect(() => {
    saveActivityUi({ stageId: activityStageId, drafts })
  }, [activityStageId, drafts])

  const template = useMemo(() => detectTemplate(goalText), [goalText])
  const questions = useMemo(() => diagnosticQuestions(template), [template])
  const path = useMemo(() => {
    if (step !== 'path') return null
    return generatePath(goalText, clarification, answers)
  }, [step, goalText, clarification, answers])
  const next = path ? nextStage(path, completedStageIds) : null
  const allDone = path !== null && next === null
  // Capability unlocks only through satisfactory practice per stage —
  // manual checkbox ticks never unlock it (correction 3).
  const activeStage =
    path?.stages.find((s) => s.id === activityStageId) ?? null
  const capabilityUnlocked =
    path !== null &&
    path.stages.length > 0 &&
    path.stages.every((s) => stageSatisfactory(s.id))
  const latestEvidence = evidenceList.length > 0 ? evidenceList[0] : null
  const capabilitySubs = subs.filter((s) => s.kind === 'capability')
  const capabilityLatest = capabilitySubs[capabilitySubs.length - 1] ?? null
  const capabilityFeedback = capabilityLatest
    ? (fbMap[capabilityLatest.id] ?? null)
    : null

  function submitGoal() {
    if (goalText.trim().length < 4) {
      setGoalError('Please describe what you want to learn — a few words is enough.')
      return
    }
    setGoalError(null)
    setParsedGoal(null)
    setParseSuggestion(null)
    setEditParsed(null)
    setParseConfirmed(false)
    setStep('clarify')
    // R2: interpret the raw goal in the background. The raw text stays
    // authoritative; the suggestion only becomes stored data on Confirm.
    // Any failure (including no API) silently keeps the raw-text flow.
    if (apiMode === 'api') {
      const text = goalText.trim()
      setParsingGoal(true)
      void fetchGoalParse(text)
        .then((result) => {
          if (result.source === 'ai' && result.parsed) {
            setParseSuggestion(result.parsed)
            setEditParsed({ ...result.parsed })
          }
        })
        .catch(() => {
          // Fallback is the raw-text flow; nothing to show.
        })
        .finally(() => {
          setParsingGoal(false)
        })
    }
  }

  function answerQuestion(questionId: string, choiceId: string) {
    setAnswers((prev) => {
      const rest = prev.filter((a) => a.questionId !== questionId)
      return [...rest, { questionId, choiceId }]
    })
  }

  function submitDiagnostic() {
    if (answers.length < questions.length) return
    setStep('path')
  }

  // ---- Phase 5 learning loop (evaluation centralized in mockCoach) ----

  function stagePracticeSubs(stageId: string): LearningSubmission[] {
    return subs.filter((s) => s.stageId === stageId && s.kind === 'practice')
  }

  function stageSatisfactory(stageId: string): boolean {
    return stagePracticeSubs(stageId).some(
      (s) => fbMap[s.id]?.verdict === 'satisfactory',
    )
  }

  function stageAttempts(stageId: string): number {
    return stagePracticeSubs(stageId).length
  }

  function ensureAiLearn(stageId: string) {
    if (aiLearn[stageId]) return
    if (apiMode !== 'api' || !path) {
      setAiLearn((prev) => ({ ...prev, [stageId]: { status: 'mock' } }))
      return
    }
    const stage = path.stages.find((s) => s.id === stageId)
    if (!stage) {
      setAiLearn((prev) => ({ ...prev, [stageId]: { status: 'mock' } }))
      return
    }
    setAiLearn((prev) => ({ ...prev, [stageId]: { status: 'loading' } }))
    const request = {
      goalText,
      outcome: path.outcome,
      stageTitle: stage.title,
      stageKind: stage.kind,
      stageDescription: stage.description,
      practiceTask: stage.practice,
      level: path.level,
    }
    void fetchLearnContent(request).then((result) => {
      setAiLearn((prev) => ({
        ...prev,
        [stageId]:
          result.source === 'ai' && result.explanation && result.example
            ? {
                status: 'ai',
                explanation: result.explanation,
                example: result.example,
              }
            : { status: 'mock' },
      }))
    })
  }

  function openStage(stageId: string) {
    setActivityStageId(stageId)
    setActivityView('learn')
    setSubmitError(null)
    ensureAiLearn(stageId)
  }

  // Restored activities (e.g. after refresh) still need their Learn content.
  useEffect(() => {
    if (step === 'path' && activityStageId) ensureAiLearn(activityStageId)
  })

  function closeActivity() {
    setActivityStageId(null)
    setActivityView('learn')
    setSubmitError(null)
  }

  async function submitPractice(stageId: string) {
    const text = (drafts[stageId] ?? '').trim()
    if (text === '') {
      setSubmitError('Write your practice response before submitting.')
      return
    }
    if (apiMode !== 'api') {
      setSubmitError(
        'The API is unavailable — reconnect to submit. Your draft is saved.',
      )
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const evaluation = evaluatePractice(
        template,
        stageId,
        text,
        stageAttempts(stageId) + 1,
      )
      const result = await postSubmission({
        stageId,
        kind: 'practice',
        response: text,
        verdict: evaluation.verdict,
        strengths: encodeList(evaluation.strengths),
        improvements: encodeList(evaluation.improvements),
        nextAction: evaluation.nextAction,
      })
      const sub: LearningSubmission = {
        id: result.submissionId,
        stageId,
        kind: 'practice',
        response: text,
        attempt: result.attempt,
      }
      setSubs((prev) => [...prev, sub])
      setFbMap((prev) => ({
        ...prev,
        [result.submissionId]: {
          submissionId: result.submissionId,
          verdict: result.verdict,
          strengths: result.strengths,
          improvements: result.improvements,
          nextAction: result.nextAction,
          proseSource: result.proseSource,
        },
      }))
      if (
        result.verdict === 'satisfactory' &&
        !completedStageIds.includes(stageId)
      ) {
        // Satisfactory practice completes the stage (progress PUT follows
        // automatically through the existing save effect).
        setCompletedStageIds((prev) => [...prev, stageId])
      }
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[stageId]
        return next
      })
      setActivityView('feedback')
    } catch {
      setSubmitError('Could not save your submission. Check the API and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitCapability() {
    const stageId = 'capability'
    const text = (drafts[stageId] ?? '').trim()
    if (text === '') {
      setSubmitError('Describe what you produced before submitting.')
      return
    }
    if (apiMode !== 'api' || !path) {
      setSubmitError(
        'The API is unavailable — reconnect to submit. Your draft is saved.',
      )
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const evaluation = evaluateCapability(template, path.outcome, text)
      const result = await postSubmission({
        stageId,
        kind: 'capability',
        response: text,
        verdict: evaluation.satisfactory ? 'satisfactory' : 'retry',
        strengths: encodeList(evaluation.strengths),
        improvements: encodeList(evaluation.improvements),
        nextAction: evaluation.satisfactory
          ? 'Your capability is recorded below.'
          : 'Strengthen the weak areas above and submit again.',
        evidence: evaluation.satisfactory
          ? {
              capability: evaluation.capability,
              result: evaluation.result,
              evidence: evaluation.evidence,
            }
          : null,
      })
      const sub: LearningSubmission = {
        id: result.submissionId,
        stageId,
        kind: 'capability',
        response: text,
        attempt: result.attempt,
      }
      setSubs((prev) => [...prev, sub])
      setFbMap((prev) => ({
        ...prev,
        [result.submissionId]: {
          submissionId: result.submissionId,
          verdict: result.verdict,
          strengths: result.strengths,
          improvements: result.improvements,
          nextAction: result.nextAction,
          proseSource: result.proseSource,
        },
      }))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[stageId]
        return next
      })
      // Refresh evidence from SQLite (server is source of truth).
      try {
        const block = await fetchLearning()
        setSubs(block.submissions)
        const map: Record<string, LearningFeedback> = {}
        for (const f of block.feedback) map[f.submissionId] = f
        setFbMap(map)
        setEvidenceList(block.evidence)
      } catch {
        // Submission already saved locally in state above.
      }
      setActivityView('feedback')
    } catch {
      setSubmitError('Could not save your submission. Check the API and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function restart() {
    localStorageAdapter.clear()
    clearActivityUi()
    clearRemoteState().catch(() => {
      // Offline: local copy is already cleared.
    })
    setSubs([])
    setFbMap({})
    setEvidenceList([])
    setAiLearn({})
    setActivityStageId(null)
    setActivityView('learn')
    setDrafts({})
    setSubmitError(null)
    setSubmitting(false)
    setGoalText('')
    setGoalError(null)
    setParsedGoal(null)
    setParseSuggestion(null)
    setEditParsed(null)
    setParseConfirmed(false)
    setParsingGoal(false)
    setClarification({
      experience: EXPERIENCE_OPTIONS[0],
      hoursPerWeek: HOURS_OPTIONS[1],
    })
    setAnswers([])
    setCompletedStageIds([])
    setRestored(false)
    setStep('goal')
  }

  function renderActivityPanel(stage: PathStage) {
    const learn = stageLearn(stage)
    const attempts = stageAttempts(stage.id)
    const stageSubs = stagePracticeSubs(stage.id)
    const latestSub = stageSubs[stageSubs.length - 1] ?? null
    const latestFb = latestSub ? (fbMap[latestSub.id] ?? null) : null
    const done = stageSatisfactory(stage.id)
    const aiEntry = aiLearn[stage.id]
    const showAi =
      aiEntry?.status === 'ai' && aiEntry.explanation && aiEntry.example
    const draft = drafts[stage.id] ?? ''
    return (
      <section
        aria-label={`Learning activity: ${stage.title}`}
        className="rounded-2xl border border-line bg-white p-6"
      >
        <button
          type="button"
          onClick={closeActivity}
          className="mb-3 rounded-[10px] border-2 border-line bg-white px-4 py-1.5 text-sm font-semibold text-muted hover:border-primary hover:text-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
        >
          ← Back to path
        </button>
        <span className="mb-2 ml-2 inline-block rounded-full bg-[#E7F4EE] px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
          {done
            ? 'Stage completed through practice ✓'
            : attempts > 0
              ? `Attempt ${attempts} submitted`
              : 'Not attempted yet'}
        </span>
        <h2 className="text-[22px] font-bold leading-snug tracking-tight text-ink">
          {stage.title}
        </h2>
        <p className="mb-4 mt-1 text-[15px] leading-relaxed text-muted">
          {stage.kind} · ~{stage.minutes} min
        </p>

        {activityView === 'learn' && (
          <div>
            <h3 className="text-lg font-bold leading-snug text-ink">Learn</h3>
            <p className="mt-1 text-[15px] leading-relaxed">
              <strong>Objective:</strong> {learn.objective}
            </p>
            {!aiEntry || aiEntry.status === 'loading' ? (
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                Preparing your lesson…
              </p>
            ) : showAi ? (
              <>
                <p className="mt-2 text-[15px] leading-relaxed">
                  {aiEntry.explanation}
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">
                  {aiEntry.example}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  AI-generated — verify with authoritative sources
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-[15px] leading-relaxed">
                  {learn.content}
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">
                  {learn.example}
                </p>
              </>
            )}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setActivityView('practice')
                  setSubmitError(null)
                }}
                className="rounded-[10px] bg-primary px-6 py-2.5 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
              >
                Start practice
              </button>
            </div>
          </div>
        )}

        {activityView === 'practice' && (
          <div>
            <h3 className="text-lg font-bold leading-snug text-ink">Practise</h3>
            <p className="mt-1 text-[15px] leading-relaxed">{stage.practice}</p>
            <div className="mt-3 rounded-xl border border-line bg-surface p-4">
              <p className="text-base font-semibold text-ink">
                How SkillPath assesses your work
              </p>
              <p className="mt-1 text-[15px] leading-relaxed">
                AI can help explain the lesson and phrase coaching feedback.
                Your assessment result is determined by the criteria below —
                not by the AI. Review them before you submit.
              </p>
              <p className="mt-2 text-[15px] leading-relaxed">
                <strong>For a satisfactory response:</strong>
              </p>
              <ul className="mt-1 grid list-disc gap-1 pl-5">
                <li className="text-[15px] leading-relaxed">
                  Explain what you did and why (at least{' '}
                  {stageAssessment(template, stage.id).minLength} characters).
                </li>
                {stageAssessment(template, stage.id).criteria.map((criterion) => (
                  <li
                    key={criterion.id}
                    className="text-[15px] leading-relaxed"
                  >
                    {criterion.label}.
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                SkillPath checks that your response addresses each requirement
                above — it does not judge correctness, reasoning quality, or
                factual accuracy.
              </p>
            </div>
            <label
              htmlFor={`practice-${stage.id}`}
              className="mb-1.5 mt-3 block text-base font-semibold text-ink"
            >
              Your response
            </label>
            <textarea
              id={`practice-${stage.id}`}
              rows={5}
              value={draft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [stage.id]: e.target.value }))
              }
              placeholder="Explain what you did and why…"
              className="w-full rounded-lg border-2 border-line bg-white px-3.5 py-2.5 text-base leading-relaxed text-ink placeholder:text-[#8A9494] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint"
            />
            {submitError && (
              <p role="alert" className="mt-2 text-[15px] font-medium text-red-700">
                {submitError}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setActivityView('learn')
                  setSubmitError(null)
                }}
                className="rounded-[10px] border-2 border-primary bg-white px-5 py-2.5 text-base font-semibold text-primary-dark hover:bg-primary-tint focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
              >
                Back to Learn
              </button>
              <button
                type="button"
                onClick={() => void submitPractice(stage.id)}
                disabled={submitting || apiMode !== 'api'}
                className="rounded-[10px] bg-primary px-6 py-2.5 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit practice'}
              </button>
            </div>
            {apiMode !== 'api' && (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Submitting needs the local API — your draft is saved.
              </p>
            )}
          </div>
        )}

        {activityView === 'feedback' && latestSub && latestFb && (
          <div>
            <h3 className="text-lg font-bold leading-snug text-ink">Feedback</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">
              Attempt {latestSub.attempt} · verdict: {latestFb.verdict}
            </p>
            {latestFb.proseSource === 'ai' && (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                AI-generated — verify with authoritative sources
              </p>
            )}
            <h4 className="mt-3 text-base font-semibold text-ink">
              What you did well
            </h4>
            <ul className="mt-1 grid gap-1">
              {decodeList(latestFb.strengths).map((item) => (
                <li key={item} className="text-[15px] leading-relaxed">
                  ✓ {item}
                </li>
              ))}
            </ul>
            <h4 className="mt-3 text-base font-semibold text-ink">
              What to improve
            </h4>
            <ul className="mt-1 grid gap-1">
              {decodeList(latestFb.improvements).map((item) => (
                <li key={item} className="text-[15px] leading-relaxed">
                  → {item}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[15px] leading-relaxed">
              <strong>Next:</strong> {latestFb.nextAction}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {latestFb.verdict === 'satisfactory' ? (
                <button
                  type="button"
                  onClick={closeActivity}
                  className="rounded-[10px] bg-primary px-6 py-2.5 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setActivityView('practice')
                    setSubmitError(null)
                  }}
                  className="rounded-[10px] bg-primary px-6 py-2.5 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  {latestFb.verdict === 'remedial'
                    ? 'Practise again with hints'
                    : 'Try again'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="min-h-screen bg-surface font-sans text-body antialiased">
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-8">
        <header className="mb-6 rounded-2xl border border-line bg-white p-6 sm:p-7">
          <div className="mb-2 flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-[22px] font-bold text-white"
            >
              S
            </div>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-ink">
              SkillPath
            </h1>
          </div>
          <p className="mt-2 text-[17px] leading-relaxed">
            A personalised AI learning coach — from intention to demonstrated
            capability.
          </p>
          <p className="mt-3 rounded-xl border border-[#CBE3DD] bg-primary-tint px-4 py-3 text-[15px] leading-relaxed text-ink">
            <strong className="text-primary-dark">SkillPath coach (mock):</strong>{' '}
            tell me what you want to learn. I will check your starting point,
            build your path and always show the next step.
          </p>
        </header>

        <div aria-live="polite" className="mb-4 text-[13px] leading-relaxed text-muted">
          {apiMode === 'checking'
            ? 'Loading your journey…'
            : apiMode === 'api' && saving
              ? 'Saving…'
              : apiMode === 'offline'
                ? 'Using offline copy (API unreachable).'
                : null}
        </div>

        <main>
          {step === 'goal' && (
            <section className="rounded-2xl border border-line bg-white p-6">
              <h2 className="text-[22px] font-bold leading-snug tracking-tight text-ink">
                Set your learning goal
              </h2>
              <p className="mb-4 mt-1 text-[15px] leading-relaxed text-muted">
                State the outcome you want — not a course name.
              </p>
              <label
                htmlFor="goal-input"
                className="mb-2 block text-[17px] font-bold leading-snug text-ink"
              >
                What do you want to learn or be able to do?
              </label>
              <p className="mb-2.5 text-sm leading-relaxed text-muted">
                Example: “I want to learn Excel so I can analyse monthly sales
                data.”
              </p>
              <input
                id="goal-input"
                type="text"
                className={inputClass}
                placeholder="e.g. I want to learn Excel for financial analysis"
                value={goalText}
                onChange={(e) => {
                  setGoalText(e.target.value)
                  if (goalError) setGoalError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitGoal()
                }}
              />
              {goalError && (
                <p role="alert" className="mt-2 text-[15px] font-medium text-red-700">
                  {goalError}
                </p>
              )}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={submitGoal}
                  className="rounded-[10px] bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  Understand my goal
                </button>
              </div>
            </section>
          )}

          {step === 'clarify' && (
            <section className="rounded-2xl border border-line bg-white p-6">
              <h2 className="text-[22px] font-bold leading-snug tracking-tight text-ink">
                Help me understand your goal
              </h2>
              <p className="mb-4 mt-1 text-[15px] leading-relaxed text-muted">
                {clarifySummary(goalText, clarification)}
              </p>
              {parsingGoal && (
                <p className="mb-4 text-[15px] leading-relaxed text-muted">
                  Understanding your goal…
                </p>
              )}
              {parseSuggestion && editParsed && !parseConfirmed && (
                <div className="mb-4 rounded-xl border border-line bg-surface p-4">
                  <p className="text-base font-semibold text-ink">
                    Here’s what I understood — correct me if needed
                  </p>
                  <label
                    htmlFor="parsed-subject"
                    className="mb-1 mt-3 block text-sm font-semibold text-ink"
                  >
                    Subject
                  </label>
                  <input
                    id="parsed-subject"
                    type="text"
                    value={editParsed.subject}
                    maxLength={120}
                    onChange={(e) =>
                      setEditParsed({ ...editParsed, subject: e.target.value })
                    }
                    className="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint"
                  />
                  <label
                    htmlFor="parsed-outcome"
                    className="mb-1 mt-3 block text-sm font-semibold text-ink"
                  >
                    Desired outcome
                  </label>
                  <input
                    id="parsed-outcome"
                    type="text"
                    value={editParsed.desiredOutcome}
                    maxLength={300}
                    onChange={(e) =>
                      setEditParsed({
                        ...editParsed,
                        desiredOutcome: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint"
                  />
                  <label
                    htmlFor="parsed-timeframe"
                    className="mb-1 mt-3 block text-sm font-semibold text-ink"
                  >
                    Timeframe
                  </label>
                  <select
                    id="parsed-timeframe"
                    value={editParsed.timeframe}
                    onChange={(e) =>
                      setEditParsed({ ...editParsed, timeframe: e.target.value })
                    }
                    className="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint"
                  >
                    <option value="">Not specified</option>
                    <option value="2 weeks">2 weeks</option>
                    <option value="1 month">1 month</option>
                    <option value="3 months">3 months</option>
                    <option value="flexible">Flexible</option>
                  </select>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (editParsed) {
                          setParsedGoal({ ...editParsed })
                          setParseConfirmed(true)
                        }
                      }}
                      className="rounded-[10px] bg-primary px-5 py-2 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setParseSuggestion(null)
                        setEditParsed(null)
                      }}
                      className="rounded-[10px] border-2 border-line bg-white px-5 py-2 text-base font-semibold text-muted hover:border-primary hover:text-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}
              {parseConfirmed && parsedGoal && (
                <div className="mb-4 rounded-xl border border-line bg-surface p-4">
                  <p className="text-[15px] leading-relaxed text-ink">
                    <strong>Confirmed goal:</strong> {parsedGoal.subject}
                    {parsedGoal.desiredOutcome !== '' &&
                      ` — ${parsedGoal.desiredOutcome}`}
                    {parsedGoal.timeframe !== '' && ` (${parsedGoal.timeframe})`}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditParsed({ ...parsedGoal })
                      setParseConfirmed(false)
                    }}
                    className="mt-2 text-sm font-semibold text-primary-dark hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                  >
                    Edit
                  </button>
                </div>
              )}
              <div className="grid gap-4">
                <div>
                  <label
                    htmlFor="experience"
                    className="mb-1.5 block text-base font-semibold text-ink"
                  >
                    What is your current experience?
                  </label>
                  <select
                    id="experience"
                    className={selectClass}
                    value={clarification.experience}
                    onChange={(e) =>
                      setClarification((c) => ({
                        ...c,
                        experience: e.target.value,
                      }))
                    }
                  >
                    {EXPERIENCE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="hours"
                    className="mb-1.5 block text-base font-semibold text-ink"
                  >
                    How much time can you practise each week?
                  </label>
                  <select
                    id="hours"
                    className={selectClass}
                    value={clarification.hoursPerWeek}
                    onChange={(e) =>
                      setClarification((c) => ({
                        ...c,
                        hoursPerWeek: e.target.value,
                      }))
                    }
                  >
                    {HOURS_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setStep('goal')}
                  className="rounded-[10px] border-2 border-primary bg-white px-5 py-2.5 text-base font-semibold text-primary-dark hover:bg-primary-tint focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnswers([])
                    setStep('diagnostic')
                  }}
                  className="rounded-[10px] bg-primary px-6 py-2.5 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  Continue to quick check
                </button>
              </div>
            </section>
          )}

          {step === 'diagnostic' && (
            <section className="rounded-2xl border border-line bg-white p-6">
              <h2 className="text-[22px] font-bold leading-snug tracking-tight text-ink">
                Quick check of your starting point
              </h2>
              <p className="mb-4 mt-1 text-[15px] leading-relaxed text-muted">
                Two short questions so the path starts at the right level. Mock
                scoring — nothing leaves your browser.
              </p>
              <div className="grid gap-5">
                {questions.map((q, qi) => (
                  <fieldset key={q.id}>
                    <legend className="mb-2 text-base font-semibold text-ink">
                      {qi + 1}. {q.prompt}
                    </legend>
                    <div className="grid gap-2">
                      {q.choices.map((c) => {
                        const checked = answers.some(
                          (a) =>
                            a.questionId === q.id && a.choiceId === c.id,
                        )
                        return (
                          <label
                            key={c.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3.5 py-2.5 text-[15px] leading-relaxed transition-colors ${
                              checked
                                ? 'border-primary bg-primary-tint text-ink'
                                : 'border-line bg-white hover:border-primary'
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              checked={checked}
                              onChange={() => answerQuestion(q.id, c.id)}
                              className="h-4 w-4 accent-[#0F766E]"
                            />
                            {c.label}
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
              {answers.length < questions.length && (
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Answer both questions to generate your path (
                  {answers.length}/{questions.length} done).
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setStep('clarify')}
                  className="rounded-[10px] border-2 border-primary bg-white px-5 py-2.5 text-base font-semibold text-primary-dark hover:bg-primary-tint focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={submitDiagnostic}
                  disabled={answers.length < questions.length}
                  className="rounded-[10px] bg-primary px-6 py-2.5 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Generate my learning path
                </button>
              </div>
            </section>
          )}

          {step === 'path' && path && (
            <div className="grid gap-6">
              {activeStage ? (
                renderActivityPanel(activeStage)
              ) : (
              <section className="rounded-2xl border border-line bg-white p-6">
                <span className="mb-2 inline-block rounded-full bg-[#E7F4EE] px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
                  Personalised path · {path.level} · mock
                </span>
                <h2 className="text-[22px] font-bold leading-snug tracking-tight text-ink">
                  {path.title}
                </h2>
                <p className="mb-4 mt-1 text-[15px] leading-relaxed text-muted">
                  Outcome: {path.outcome}
                </p>
                <ol className="grid gap-3">
                  {path.stages.map((s, i) => {
                    const done = completedStageIds.includes(s.id)
                    return (
                      <li
                        key={s.id}
                        className={`rounded-xl border p-4 ${
                          done
                            ? 'border-[#BFE0D2] bg-[#E7F4EE]'
                            : 'border-line bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div>
                            <p className="text-base font-bold leading-snug text-ink">
                              {i + 1}. {s.title}{' '}
                              <span className="font-medium text-muted">
                                · {s.kind} · ~{s.minutes} min
                              </span>
                            </p>
                            <p className="mt-1 text-[15px] leading-relaxed">
                              {s.description}
                            </p>
                            <p className="mt-1 text-[15px] leading-relaxed">
                              <strong>Practise:</strong> {s.practice}
                            </p>
                            <ul className="mt-2 grid gap-1">
                              {s.resources.map((r) => (
                                <li
                                  key={r.title}
                                  className="text-sm leading-relaxed text-muted"
                                >
                                  <strong className="text-ink">{r.title}</strong>{' '}
                                  ({r.source}) — {r.why}
                                </li>
                              ))}
                            </ul>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openStage(s.id)}
                                className="rounded-[10px] border-2 border-primary bg-white px-4 py-1.5 text-sm font-semibold text-primary-dark hover:bg-primary-tint focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                              >
                                Open learning activity
                              </button>
                              {stageSatisfactory(s.id) ? (
                                <span className="text-sm font-semibold text-primary-dark">
                                  Satisfactory ✓
                                </span>
                              ) : stagePracticeSubs(s.id).length > 0 ? (
                                <span className="text-sm text-muted">
                                  Attempt {stagePracticeSubs(s.id).length} ·
                                  needs work
                                </span>
                              ) : (
                                <span className="text-sm text-muted">
                                  Not attempted
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>
              )}

              {capabilityUnlocked && activityStageId === null && (
                <section
                  aria-label="Capability demonstration"
                  className="rounded-2xl border-2 border-primary bg-white p-6"
                >
                  <span className="mb-2 inline-block rounded-full bg-[#E7F4EE] px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
                    Capability demonstration
                  </span>
                  <h2 className="text-[22px] font-bold leading-snug tracking-tight text-ink">
                    {capabilityTask(template, goalText, path.outcome).title}
                  </h2>
                  <p className="mb-4 mt-1 text-[15px] leading-relaxed text-muted">
                    {
                      capabilityTask(template, goalText, path.outcome)
                        .instructions
                    }
                  </p>
                  {latestEvidence && (
                    <p className="mb-4 rounded-xl border border-[#BFE0D2] bg-[#E7F4EE] px-4 py-3 text-[15px] leading-relaxed text-ink">
                      <strong>Demonstrated ability:</strong>{' '}
                      {latestEvidence.capability} Evidence demonstrations so
                      far: {evidenceList.length}.
                    </p>
                  )}
                  {capabilityLatest && capabilityFeedback && (
                    <div className="mb-4 rounded-xl border border-line bg-surface px-4 py-3">
                      <p className="text-[15px] leading-relaxed text-ink">
                        <strong>
                          Latest result ({capabilityFeedback.verdict}, attempt{' '}
                          {capabilityLatest.attempt}):
                        </strong>{' '}
                        {capabilityFeedback.verdict === 'satisfactory'
                          ? 'Capability recorded above.'
                          : decodeList(capabilityFeedback.improvements)[0] ??
                            'See feedback and try again.'}
                      </p>
                      {capabilityFeedback.proseSource === 'ai' && (
                        <p className="mt-1 text-[13px] leading-relaxed text-muted">
                          AI-generated — verify with authoritative sources
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mb-4 rounded-xl border border-line bg-surface p-4">
                    <p className="text-base font-semibold text-ink">
                      How this demonstration is assessed
                    </p>
                    <p className="mt-1 text-[15px] leading-relaxed">
                      AI can help phrase coaching feedback. Whether this
                      counts as demonstrated capability is determined by the
                      criteria below — not by the AI.
                    </p>
                    <p className="mt-2 text-[15px] leading-relaxed">
                      <strong>For a satisfactory demonstration:</strong>
                    </p>
                    <ul className="mt-1 grid list-disc gap-1 pl-5">
                      <li className="text-[15px] leading-relaxed">
                        Describe what you produced and the steps you took in
                        enough detail (at least{' '}
                        {capabilityCriteria(template).minLength} characters).
                      </li>
                      <li className="text-[15px] leading-relaxed">
                        Cover at least {capabilityCriteria(template).minHits}{' '}
                        key concepts for your goal in your description.
                      </li>
                    </ul>
                  </div>
                  <label
                    htmlFor="capability-response"
                    className="mb-1.5 block text-base font-semibold text-ink"
                  >
                    Your demonstration
                  </label>
                  <textarea
                    id="capability-response"
                    rows={6}
                    value={drafts['capability'] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        capability: e.target.value,
                      }))
                    }
                    placeholder="Describe what you produced, the steps you took, and what it demonstrates…"
                    className="w-full rounded-lg border-2 border-line bg-white px-3.5 py-2.5 text-base leading-relaxed text-ink placeholder:text-[#8A9494] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-tint"
                  />
                  {submitError && activityStageId === null && (
                    <p role="alert" className="mt-2 text-[15px] font-medium text-red-700">
                      {submitError}
                    </p>
                  )}
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void submitCapability()}
                      disabled={submitting || apiMode !== 'api'}
                      className="rounded-[10px] bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submitting ? 'Submitting…' : 'Submit demonstration'}
                    </button>
                  </div>
                  {apiMode !== 'api' && (
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      Submitting needs the local API — your draft is saved.
                    </p>
                  )}
                </section>
              )}

              <section
                aria-label="Next learning action"
                className="rounded-2xl border-2 border-primary bg-primary-tint p-6 text-ink"
              >
                <span className="mb-2 inline-block rounded-full bg-[#E7F4EE] px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
                  Next learning action
                </span>
                {next ? (
                  <>
                    <h3 className="text-lg font-bold leading-snug">
                      {next.title} — {next.practice}
                    </h3>
                    <p className="mb-4 mt-1 text-[15px] leading-relaxed">
                      About {next.minutes} minutes · {next.kind} step. Complete
                      its practice with a satisfactory result to advance.
                    </p>
                    <button
                      type="button"
                      onClick={() => openStage(next.id)}
                      className="rounded-[10px] bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                    >
                      Open this stage
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-bold leading-snug">
                      Path complete — capability demonstrated
                    </h3>
                    <p className="mb-4 mt-1 text-[15px] leading-relaxed">
                      {allDone
                        ? 'You finished every stage. In the full SkillPath this becomes recorded evidence of ability.'
                        : ''}
                    </p>
                    <button
                      type="button"
                      onClick={restart}
                      className="rounded-[10px] bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                    >
                      Start a new goal
                    </button>
                  </>
                )}
              </section>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setStep('diagnostic')}
                  className="rounded-[10px] border-2 border-primary bg-white px-5 py-2.5 text-base font-semibold text-primary-dark hover:bg-primary-tint focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  Retake quick check
                </button>
                <button
                  type="button"
                  onClick={restart}
                  className="rounded-[10px] border-2 border-line bg-white px-5 py-2.5 text-base font-semibold text-muted hover:border-primary hover:text-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                >
                  Reset demo
                </button>
              </div>
            </div>
          )}
        </main>

        <footer className="mt-8 text-center text-[13px] leading-relaxed text-muted">
          SkillPath prototype — mock coaching, local demo data only. No account,
          no external services. Local SQLite + Express API.
        </footer>
      </div>
    </div>
  )
}
