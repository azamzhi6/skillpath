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
