// Deterministic MOCK coach engine. No external AI calls.
// Stable function signatures so a real model can replace this module later.

import type {
  Clarification,
  DiagnosticAnswer,
  LearningPath,
  PathStage,
} from './types'

export type TemplateId = 'excel' | 'web' | 'data' | 'generic'

interface DiagnosticQuestion {
  id: string
  prompt: string
  choices: { id: string; label: string; scores: number }[]
}

const TEMPLATE_KEYWORDS: Record<Exclude<TemplateId, 'generic'>, string[]> = {
  excel: ['excel', 'spreadsheet', 'financial', 'finance', 'pivot'],
  web: ['website', 'web', 'html', 'css', 'frontend', 'landing'],
  data: ['data', 'analysis', 'analyse', 'analyze', 'health', 'dataset', 'python', 'sql'],
}

export function detectTemplate(goalText: string): TemplateId {
  const text = goalText.toLowerCase()
  for (const [id, keywords] of Object.entries(TEMPLATE_KEYWORDS)) {
    if (keywords.some((k) => text.includes(k))) return id as TemplateId
  }
  return 'generic'
}

export function clarifySummary(goalText: string, c: Clarification): string {
  return `Goal: ${goalText.trim()} — current experience: ${c.experience.toLowerCase()}, about ${c.hoursPerWeek.toLowerCase()} available per week.`
}

const DIAGNOSTICS: Record<TemplateId, DiagnosticQuestion[]> = {
  excel: [
    {
      id: 'excel-1',
      prompt: 'Which formula adds up only the rows that meet a condition?',
      choices: [
        { id: 'a', label: 'SUM', scores: 0 },
        { id: 'b', label: 'SUMIFS', scores: 1 },
        { id: 'c', label: 'AVERAGE', scores: 0 },
      ],
    },
    {
      id: 'excel-2',
      prompt: 'Have you built a PivotTable before?',
      choices: [
        { id: 'a', label: 'Never', scores: 0 },
        { id: 'b', label: 'Once, with help', scores: 1 },
        { id: 'c', label: 'Several times alone', scores: 2 },
      ],
    },
  ],
  web: [
    {
      id: 'web-1',
      prompt: 'What does HTML mainly describe?',
      choices: [
        { id: 'a', label: 'Page structure and content', scores: 1 },
        { id: 'b', label: 'Page colours and fonts', scores: 0 },
        { id: 'c', label: 'Server databases', scores: 0 },
      ],
    },
    {
      id: 'web-2',
      prompt: 'Have you published a web page before?',
      choices: [
        { id: 'a', label: 'Never', scores: 0 },
        { id: 'b', label: 'Once, with help', scores: 1 },
        { id: 'c', label: 'Several times alone', scores: 2 },
      ],
    },
  ],
  data: [
    {
      id: 'data-1',
      prompt: 'A dataset has missing values. What is the safest first move?',
      choices: [
        { id: 'a', label: 'Delete all incomplete rows immediately', scores: 0 },
        { id: 'b', label: 'Inspect how many are missing and why', scores: 1 },
        { id: 'c', label: 'Replace them all with zero', scores: 0 },
      ],
    },
    {
      id: 'data-2',
      prompt: 'Have you cleaned a real dataset before?',
      choices: [
        { id: 'a', label: 'Never', scores: 0 },
        { id: 'b', label: 'Once, with help', scores: 1 },
        { id: 'c', label: 'Several times alone', scores: 2 },
      ],
    },
  ],
  generic: [
    {
      id: 'gen-1',
      prompt: 'How would you describe your current level?',
      choices: [
        { id: 'a', label: 'Complete beginner', scores: 0 },
        { id: 'b', label: 'Tried it once or twice', scores: 1 },
        { id: 'c', label: 'Comfortable with basics', scores: 2 },
      ],
    },
    {
      id: 'gen-2',
      prompt: 'How do you prefer to practise?',
      choices: [
        { id: 'a', label: 'Short guided steps', scores: 0 },
        { id: 'b', label: 'Examples I can copy first', scores: 1 },
        { id: 'c', label: 'A real task of my own', scores: 2 },
      ],
    },
  ],
}

export function diagnosticQuestions(template: TemplateId): DiagnosticQuestion[] {
  return DIAGNOSTICS[template]
}

function scoreAnswers(
  template: TemplateId,
  answers: DiagnosticAnswer[],
): number {
  const byId = new Map(
    DIAGNOSTICS[template].flatMap((q) =>
      q.choices.map((c) => [`${q.id}:${c.id}`, c.scores]),
    ),
  )
  return answers.reduce(
    (sum, a) => sum + (byId.get(`${a.questionId}:${a.choiceId}`) ?? 0),
    0,
  )
}

export type CoachLevel = 'Starting out' | 'Developing'

export function levelForScore(score: number): CoachLevel {
  return score >= 3 ? 'Developing' : 'Starting out'
}

export function diagnosticScore(
  template: TemplateId,
  answers: DiagnosticAnswer[],
): { score: number; level: CoachLevel } {
  const score = scoreAnswers(template, answers)
  return { score, level: levelForScore(score) }
}

interface PathTemplate {
  title: string
  outcome: string
  stages: PathStage[]
}

const PATHS: Record<TemplateId, PathTemplate> = {
  excel: {
    title: 'Excel for Financial Analysis',
    outcome:
      'Clean, analyse and present a monthly sales dataset with supporting charts.',
    stages: [
      {
        id: 'excel-s1',
        title: 'Spreadsheet foundations',
        kind: 'Learn',
        description: 'Structure, formatting and validation for reliable sheets.',
        practice: 'Format and validate a 50-row sales table.',
        minutes: 20,
        resources: [
          {
            title: 'Excel data validation basics',
            source: 'Microsoft Support',
            why: 'Prevents bad inputs before analysis starts.',
          },
        ],
      },
      {
        id: 'excel-s2',
        title: 'Formulas that matter',
        kind: 'Practise',
        description: 'SUMIFS and XLOOKUP applied to real sales questions.',
        practice: 'Answer three margin questions with SUMIFS and XLOOKUP.',
        minutes: 25,
        resources: [
          {
            title: 'SUMIFS walkthrough with examples',
            source: 'Mock coach library',
            why: 'Worked examples matched to your sales data.',
          },
        ],
      },
      {
        id: 'excel-s3',
        title: 'PivotTables and charts',
        kind: 'Produce',
        description: 'Summarise margins by month and present the story.',
        practice: 'Produce a one-page monthly margin summary with a chart.',
        minutes: 30,
        resources: [
          {
            title: 'Designing readable charts',
            source: 'Mock coach library',
            why: 'Shows how to present the result, not just compute it.',
          },
        ],
      },
    ],
  },
  web: {
    title: 'Build Your First Website',
    outcome: 'Design, build and explain a small responsive landing page.',
    stages: [
      {
        id: 'web-s1',
        title: 'How pages are structured',
        kind: 'Learn',
        description: 'HTML structure: headings, sections, links and images.',
        practice: 'Mark up a one-section page outline in HTML.',
        minutes: 20,
        resources: [
          {
            title: 'HTML structure primer',
            source: 'Mock coach library',
            why: 'The minimum structure behind every page.',
          },
        ],
      },
      {
        id: 'web-s2',
        title: 'Styling with confidence',
        kind: 'See',
        description: 'CSS layout, spacing and readable type.',
        practice: 'Style your outline into a clean single-column layout.',
        minutes: 25,
        resources: [
          {
            title: 'Spacing and type for beginners',
            source: 'Mock coach library',
            why: 'Demonstrated on a page like yours.',
          },
        ],
      },
      {
        id: 'web-s3',
        title: 'Publish and explain it',
        kind: 'Produce',
        description: 'Responsive tweaks, then explain your choices.',
        practice: 'Make it mobile-friendly and record a 2-minute walkthrough.',
        minutes: 30,
        resources: [
          {
            title: 'Responsive basics checklist',
            source: 'Mock coach library',
            why: 'A short checklist you apply to your own page.',
          },
        ],
      },
    ],
  },
  data: {
    title: 'Data Analysis Foundations',
    outcome: 'Clean a messy dataset and present one clear finding with a chart.',
    stages: [
      {
        id: 'data-s1',
        title: 'Understanding data',
        kind: 'Learn',
        description: 'Rows, columns, types and what “clean” means.',
        practice: 'Profile a sample health-programme dataset: types and gaps.',
        minutes: 20,
        resources: [
          {
            title: 'Reading a dataset critically',
            source: 'Mock coach library',
            why: 'Builds the inspection habit first.',
          },
        ],
      },
      {
        id: 'data-s2',
        title: 'Cleaning with care',
        kind: 'Practise',
        description: 'Handle missing and inconsistent values deliberately.',
        practice: 'Clean the dataset and log every decision you made.',
        minutes: 30,
        resources: [
          {
            title: 'Missing-data decision guide',
            source: 'Mock coach library',
            why: 'Worked examples matched to your level.',
          },
        ],
      },
      {
        id: 'data-s3',
        title: 'Summarise and show',
        kind: 'Produce',
        description: 'Descriptive summary plus one honest chart.',
        practice: 'Produce a one-page finding with a chart and two caveats.',
        minutes: 30,
        resources: [
          {
            title: 'One-chart, one-finding method',
            source: 'Mock coach library',
            why: 'Keeps the first result small and defensible.',
          },
        ],
      },
    ],
  },
  generic: {
    title: 'Your Personal Learning Path',
    outcome: 'Demonstrate your goal on a small real task of your own.',
    stages: [
      {
        id: 'gen-s1',
        title: 'Understand the essentials',
        kind: 'Learn',
        description: 'The core ideas behind your goal, in plain language.',
        practice: 'Explain the three key ideas back in your own words.',
        minutes: 20,
        resources: [
          {
            title: 'Starter guide matched to your goal',
            source: 'Mock coach library',
            why: 'Chosen for your stated outcome.',
          },
        ],
      },
      {
        id: 'gen-s2',
        title: 'See it done',
        kind: 'See',
        description: 'A worked example you can follow step by step.',
        practice: 'Reproduce the worked example with your own data.',
        minutes: 25,
        resources: [
          {
            title: 'Worked example for your goal',
            source: 'Mock coach library',
            why: 'Shows the method before you practise alone.',
          },
        ],
      },
      {
        id: 'gen-s3',
        title: 'Practise and show ability',
        kind: 'Produce',
        description: 'Independent practice on a task that matters to you.',
        practice: 'Complete your task and note what you would improve.',
        minutes: 30,
        resources: [
          {
            title: 'Practice task planner',
            source: 'Mock coach library',
            why: 'Turns your goal into a demonstrable result.',
          },
        ],
      },
    ],
  },
}

export function generatePath(
  goalText: string,
  clarification: Clarification,
  answers: DiagnosticAnswer[],
): LearningPath {
  const template = detectTemplate(goalText)
  const base = PATHS[template]
  const { level } = diagnosticScore(template, answers)
  // Mock adaptation: developing learners skip the gentlest intro wording.
  const stages =
    level === 'Developing'
      ? base.stages.map((s, i) =>
          i === 0
            ? { ...s, description: `${s.description} ( brisk pace — you already know the basics).` }
            : s,
        )
      : base.stages
  void clarification
  return { title: base.title, outcome: base.outcome, level, stages }
}

export function nextStage(path: LearningPath, completedIds: string[]) {
  return path.stages.find((s) => !completedIds.includes(s.id)) ?? null
}

// ---- Phase 5: deterministic learning-loop evaluation (mock) ----
// Centralized evaluators. The UI calls these and uses the result; no
// evaluation rules live anywhere else. No LLM, no external calls.

export type PracticeVerdict = 'satisfactory' | 'retry' | 'remedial'

export interface PracticeEvaluation {
  verdict: PracticeVerdict
  strengths: string[]
  improvements: string[]
  nextAction: string
}

export interface StageLearnContent {
  objective: string
  content: string
  example: string
}

export interface CapabilityTask {
  title: string
  instructions: string
}

export interface CapabilityEvaluation {
  satisfactory: boolean
  strengths: string[]
  improvements: string[]
  capability: string
  result: string
  evidence: string
}

const PRACTICE_KEYWORDS: Record<TemplateId, string[]> = {
  excel: ['sumifs', 'xlookup', 'pivot', 'clean', 'chart', 'margin', 'formula'],
  web: ['html', 'css', 'responsive', 'layout', 'heading', 'link', 'publish'],
  data: ['clean', 'missing', 'chart', 'average', 'dataset', 'insight', 'visual'],
  generic: ['learn', 'practice', 'example', 'plan', 'goal', 'result', 'steps'],
}

const PRACTICE_MIN_LENGTH = 20
const PRACTICE_MIN_HITS = 2
const CAPABILITY_MIN_LENGTH = 60
const CAPABILITY_MIN_HITS = 3

function keywordHits(template: TemplateId, response: string): string[] {
  const text = response.toLowerCase()
  return PRACTICE_KEYWORDS[template].filter((kw) => text.includes(kw))
}

function missingKeywords(template: TemplateId, response: string): string[] {
  const text = response.toLowerCase()
  return PRACTICE_KEYWORDS[template].filter((kw) => !text.includes(kw))
}

export function stageLearn(stage: PathStage): StageLearnContent {
  const byKind: Record<PathStage['kind'], string> = {
    Learn: `Read the explanation below, then study the worked example before you try anything yourself.`,
    See: `Watch how the task is done in the example first — notice each step, then reproduce it.`,
    Practise: `Try the task with guidance. Compare your attempt with the example as you go.`,
    Produce: `Produce the result independently, as you would in real work.`,
  }
  const resource = stage.resources[0]
  return {
    objective: stage.description,
    content: `${stage.description} ${byKind[stage.kind]} Allow about ${stage.minutes} minutes.`,
    example: resource
      ? `Worked example — ${resource.title} (${resource.source}): ${resource.why}`
      : `Worked example: follow the practice task below step by step.`,
  }
}

export function evaluatePractice(
  template: TemplateId,
  response: string,
  attempt: number,
): PracticeEvaluation {
  const trimmed = response.trim()
  const hits = keywordHits(template, trimmed)
  const missing = missingKeywords(template, trimmed)
  if (trimmed.length >= PRACTICE_MIN_LENGTH && hits.length >= PRACTICE_MIN_HITS) {
    return {
      verdict: 'satisfactory',
      strengths: hits
        .slice(0, 2)
        .map((kw) => `Good use of "${kw}" — applied in the right context.`),
      improvements: [
        'Keep this standard on the next stage: show your method, not just the answer.',
      ],
      nextAction: 'Continue to the next stage.',
    }
  }
  const improvements: string[] = []
  if (trimmed.length < PRACTICE_MIN_LENGTH) {
    improvements.push(
      `Your response is quite short (${trimmed.length} characters). Aim for at least ${PRACTICE_MIN_LENGTH} characters explaining what you did and why.`,
    )
  }
  if (missing.length > 0) {
    improvements.push(
      `Try including ${missing
        .slice(0, 2)
        .map((kw) => `"${kw}"`)
        .join(' and ')} — they show the key ideas of this stage.`,
    )
  }
  if (attempt >= 2) {
    return {
      verdict: 'remedial',
      strengths:
        hits.length > 0
          ? [`You correctly brought in "${hits[0]}" — build on that.`]
          : ['You attempted the task — that is the right starting point.'],
      improvements: [
        ...improvements,
        `Remedial hint: a strong answer mentions ${PRACTICE_KEYWORDS[template]
          .slice(0, 3)
          .map((kw) => `"${kw}"`)
          .join(', ')}. Keep practising — submit again when ready.`,
      ],
      nextAction: 'Practise again with the hints above, then submit.',
    }
  }
  return {
    verdict: 'retry',
    strengths:
      hits.length > 0
        ? [`Good use of "${hits[0]}" — applied in the right context.`]
        : ['You made an attempt — a good start.'],
    improvements,
    nextAction: 'Try the practice again, then submit.',
  }
}

export function capabilityTask(
  template: TemplateId,
  goalText: string,
  outcome: string,
): CapabilityTask {
  void template
  return {
    title: 'Final capability demonstration',
    instructions: `Show what you can now do. Goal: ${goalText.trim()} Expected outcome: ${outcome} Describe what you produced, the steps you took, and what the result demonstrates. Aim for at least ${CAPABILITY_MIN_LENGTH} characters.`,
  }
}

export function evaluateCapability(
  template: TemplateId,
  outcome: string,
  response: string,
): CapabilityEvaluation {
  const trimmed = response.trim()
  const hits = keywordHits(template, trimmed)
  const satisfactory =
    trimmed.length >= CAPABILITY_MIN_LENGTH && hits.length >= CAPABILITY_MIN_HITS
  const strengths = satisfactory
    ? hits
        .slice(0, 3)
        .map((kw) => `Demonstrated "${kw}" in a realistic context.`)
    : hits.length > 0
      ? [`You demonstrated "${hits[0]}" — extend this across the whole task.`]
      : ['You described an attempt — now connect it to the outcome.']
  const improvements = satisfactory
    ? ['Keep a copy of this work as portfolio evidence.']
    : [
        `Aim for at least ${CAPABILITY_MIN_LENGTH} characters covering the full outcome, including ${missingKeywords(template, trimmed)
          .slice(0, 2)
          .map((kw) => `"${kw}"`)
          .join(' and ')}.`,
      ]
  return {
    satisfactory,
    strengths,
    improvements,
    capability: outcome,
    result: satisfactory ? 'satisfactory' : 'needs-work',
    evidence: trimmed.slice(0, 500),
  }
}
