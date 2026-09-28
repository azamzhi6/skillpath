import { useEffect, useMemo, useState } from 'react'
import {
  clarifySummary,
  detectTemplate,
  diagnosticQuestions,
  diagnosticScore,
  generatePath,
  nextStage,
} from './mockCoach'
import {
  apiHealth,
  clearRemoteState,
  fetchRemoteState,
  localStorageAdapter,
  pushRemoteState,
  type ApiJourneySnapshot,
} from './storage'
import type {
  Clarification,
  DiagnosticAnswer,
  LearnerState,
  Step,
} from './types'

const EXPERIENCE_OPTIONS = [
  'Complete beginner',
  'Tried it before',
  'Comfortable with basics',
]

const HOURS_OPTIONS = ['2 hours', '4 hours', '6+ hours']

type PersistenceMode = 'checking' | 'api' | 'offline'

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
  const [apiMode, setApiMode] = useState<PersistenceMode>('checking')
  const [saving, setSaving] = useState(false)

  function applyState(saved: LearnerState) {
    setGoalText(saved.goalText)
    if (saved.clarification) setClarification(saved.clarification)
    setAnswers(saved.answers)
    setCompletedStageIds(saved.completedStageIds)
    if (saved.clarification && saved.answers.length > 0) setStep('path')
    else if (saved.clarification) setStep('diagnostic')
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
            await pushRemoteState(buildSnapshot(local)).catch(() => {
              if (!cancelled) setApiMode('offline')
            })
            return
          }
        } catch {
          if (!cancelled) setApiMode('offline')
        }
      } else {
        setApiMode('offline')
      }
      if (cancelled) return
      if (local && local.goalText.trim()) applyState(local)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist progress: always mirror locally; write through to SQLite/API
  // while it is healthy (local copy doubles as the offline fallback).
  useEffect(() => {
    if (!restored && goalText.trim() === '') return
    const state: LearnerState = {
      goalText,
      clarification: step === 'goal' ? null : clarification,
      answers,
      completedStageIds,
    }
    if (goalText.trim() === '') return
    localStorageAdapter.save(state)
    if (apiMode === 'api') {
      setSaving(true)
      pushRemoteState(buildSnapshot(state))
        .then(() => setSaving(false))
        .catch(() => {
          setSaving(false)
          setApiMode('offline')
        })
    }
  }, [goalText, clarification, answers, completedStageIds, step, restored, apiMode])

  const template = useMemo(() => detectTemplate(goalText), [goalText])
  const questions = useMemo(() => diagnosticQuestions(template), [template])
  const path = useMemo(() => {
    if (step !== 'path') return null
    return generatePath(goalText, clarification, answers)
  }, [step, goalText, clarification, answers])
  const next = path ? nextStage(path, completedStageIds) : null
  const allDone = path !== null && next === null

  function submitGoal() {
    if (goalText.trim().length < 4) {
      setGoalError('Please describe what you want to learn — a few words is enough.')
      return
    }
    setGoalError(null)
    setStep('clarify')
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

  function toggleStage(stageId: string) {
    setCompletedStageIds((prev) =>
      prev.includes(stageId)
        ? prev.filter((id) => id !== stageId)
        : [...prev, stageId],
    )
  }

  function restart() {
    localStorageAdapter.clear()
    clearRemoteState().catch(() => {
      // Offline: local copy is already cleared.
    })
    setGoalText('')
    setGoalError(null)
    setClarification({
      experience: EXPERIENCE_OPTIONS[0],
      hoursPerWeek: HOURS_OPTIONS[1],
    })
    setAnswers([])
    setCompletedStageIds([])
    setRestored(false)
    setStep('goal')
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
          {apiMode === 'api' && saving
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
                          <input
                            id={`stage-${s.id}`}
                            type="checkbox"
                            checked={done}
                            onChange={() => toggleStage(s.id)}
                            className="mt-1 h-5 w-5 accent-[#0F766E]"
                          />
                          <div>
                            <label
                              htmlFor={`stage-${s.id}`}
                              className="cursor-pointer text-base font-bold leading-snug text-ink"
                            >
                              {i + 1}. {s.title}{' '}
                              <span className="font-medium text-muted">
                                · {s.kind} · ~{s.minutes} min
                              </span>
                            </label>
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
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>

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
                      About {next.minutes} minutes · {next.kind} step. Ticking
                      it off above updates this card.
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleStage(next.id)}
                      className="rounded-[10px] bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary"
                    >
                      Mark this step done
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
          no backend, no external services.
        </footer>
      </div>
    </div>
  )
}
