// Deterministic MOCK coach engine. No external AI calls.
// Stable function signatures so a real model can replace this module later.

import type {
  Clarification,
  DiagnosticAnswer,
  LearningPath,
  PathStage,
  StageCriterion,
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
        criteria: [
          {
            id: 'excel-s1-structure',
            label: 'Set up a clear table structure',
            groups: [['table', 'header', 'column', 'row', 'format']],
          },
          {
            id: 'excel-s1-validation',
            label: 'Add validation to catch bad entries',
            groups: [['valid', 'validation', 'check', 'rule', 'error']],
          },
          {
            id: 'excel-s1-application',
            label: 'Apply the setup to the sales data',
            groups: [
              ['sales', 'data', 'rows'],
              ['format', 'clean', 'enter', 'type'],
            ],
          },
        ],
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
        criteria: [
          {
            id: 'excel-s2-conditional',
            label: 'Use conditional sums for the margin questions',
            groups: [['sumifs', 'sum if', 'conditional sum', 'total']],
          },
          {
            id: 'excel-s2-lookup',
            label: 'Use lookups to pull in related values',
            groups: [['xlookup', 'vlookup', 'lookup']],
          },
          {
            id: 'excel-s2-application',
            label: 'Tie both formulas to the margin data',
            groups: [
              ['sumifs', 'xlookup', 'formula'],
              ['margin', 'sales', 'month', 'data'],
            ],
          },
        ],
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
        criteria: [
          {
            id: 'excel-s3-summary',
            label: 'Summarise the data by month',
            groups: [
              ['pivot', 'month', 'summary', 'summarise', 'summarize', 'total'],
            ],
          },
          {
            id: 'excel-s3-visual',
            label: 'Show the result visually',
            groups: [['chart', 'graph', 'visual', 'plot']],
          },
          {
            id: 'excel-s3-story',
            label: 'Present the margin story on one page',
            groups: [
              ['margin', 'profit', 'sales'],
              ['page', 'report', 'present'],
            ],
          },
        ],
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
        criteria: [
          {
            id: 'web-s1-structure',
            label: 'Structure the page with headings',
            groups: [['heading', 'h1', 'h2', 'title', 'structure']],
          },
          {
            id: 'web-s1-media',
            label: 'Include links or images',
            groups: [['link', 'image', 'img', 'anchor', 'href', 'src']],
          },
          {
            id: 'web-s1-outline',
            label: 'Outline a complete section',
            groups: [['section', 'outline', 'page', 'content']],
          },
        ],
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
        criteria: [
          {
            id: 'web-s2-styling',
            label: 'Apply CSS styling to the outline',
            groups: [['css', 'style', 'stylesheet', 'class']],
          },
          {
            id: 'web-s2-layout',
            label: 'Control the layout and spacing',
            groups: [['layout', 'spacing', 'margin', 'padding', 'column']],
          },
          {
            id: 'web-s2-type',
            label: 'Make the text readable',
            groups: [['font', 'readable', 'color', 'colour', 'size', 'type']],
          },
        ],
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
        criteria: [
          {
            id: 'web-s3-mobile',
            label: 'Adapt the page for mobile screens',
            groups: [['mobile', 'responsive']],
          },
          {
            id: 'web-s3-explain',
            label: 'Explain the choices made',
            groups: [['explain', 'walkthrough', 'choice', 'because', 'reason']],
          },
          {
            id: 'web-s3-share',
            label: 'Share or publish the result',
            groups: [['publish', 'share', 'link', 'deploy', 'upload']],
          },
        ],
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
        criteria: [
          {
            id: 'data-s1-types',
            label: 'Identify the column types in the dataset',
            groups: [['type', 'column', 'number', 'text', 'date', 'category']],
          },
          {
            id: 'data-s1-gaps',
            label: 'Spot gaps and missing values',
            groups: [['missing', 'gap', 'empty', 'null', 'incomplete']],
          },
          {
            id: 'data-s1-grounding',
            label: 'Ground the profile in the health data',
            groups: [
              ['health', 'patient', 'programme', 'program', 'dataset', 'data'],
              ['profile', 'inspect', 'check', 'look', 'describe'],
            ],
          },
        ],
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
        criteria: [
          {
            id: 'data-s2-problems',
            label: 'Handle the problem values in the data',
            groups: [['clean', 'missing', 'duplicate', 'fix', 'remove', 'fill']],
          },
          {
            id: 'data-s2-log',
            label: 'Log each decision made while cleaning',
            groups: [['log', 'decision', 'record', 'note', 'document', 'why']],
          },
          {
            id: 'data-s2-usable',
            label: 'Leave the data fit for analysis',
            groups: [
              ['analysis', 'result', 'use', 'valid', 'consistent'],
              ['clean', 'keep'],
            ],
          },
        ],
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
        criteria: [
          {
            id: 'data-s3-finding',
            label: 'State the main finding from the data',
            groups: [
              ['finding', 'summary', 'result', 'insight', 'average', 'total'],
            ],
          },
          {
            id: 'data-s3-chart',
            label: 'Support the finding with a chart',
            groups: [['chart', 'graph', 'visual', 'plot', 'figure']],
          },
          {
            id: 'data-s3-caveats',
            label: 'Give at least two caveats on the finding',
            groups: [
              ['caveat', 'limit', 'warning', 'caution', 'assumption', 'bias'],
            ],
          },
        ],
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
        criteria: [
          {
            id: 'gen-s1-ideas',
            label: 'Name the key ideas',
            groups: [['idea', 'concept', 'key', 'principle', 'three']],
          },
          {
            id: 'gen-s1-own-words',
            label: 'Explain the ideas in your own words',
            groups: [['explain', 'because', 'means', 'example', 'understand']],
          },
          {
            id: 'gen-s1-goal',
            label: 'Connect the ideas to the learning goal',
            groups: [
              ['goal', 'learn', 'task'],
              ['plan', 'apply', 'use'],
            ],
          },
        ],
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
        criteria: [
          {
            id: 'gen-s2-steps',
            label: 'Follow the steps of the worked example',
            groups: [['example', 'step', 'follow', 'reproduce', 'copy']],
          },
          {
            id: 'gen-s2-own-data',
            label: 'Use your own data in the reproduction',
            groups: [['own', 'data', 'my', 'real']],
          },
          {
            id: 'gen-s2-outcome',
            label: 'Show what came out of the reproduction',
            groups: [['result', 'outcome', 'produce', 'complete', 'work']],
          },
        ],
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
        criteria: [
          {
            id: 'gen-s3-complete',
            label: 'Complete the task itself',
            groups: [['complete', 'finish', 'done', 'produce', 'task']],
          },
          {
            id: 'gen-s3-review',
            label: 'Judge what worked and what did not',
            groups: [
              ['improve', 'better', 'weak', 'strong', 'review', 'reflect', 'wrong'],
            ],
          },
          {
            id: 'gen-s3-next',
            label: 'State a concrete next step',
            groups: [['next', 'plan', 'practise', 'practice', 'continue', 'again']],
          },
        ],
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
  // Per-criterion outcomes behind this verdict. The UI sends these to the
  // server for Learner Model memory; the verdict itself is unchanged.
  results: CriterionResult[]
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

const PRACTICE_MIN_LENGTH = 20
const CAPABILITY_MIN_LENGTH = 60

export interface CapabilityBrief {
  title: string
  instructions: string
  minLength: number
  criteria: StageCriterion[]
}

const CAPABILITY_BRIEFS: Record<TemplateId, CapabilityBrief> = {
  excel: {
    title: 'Final capability demonstration',
    minLength: CAPABILITY_MIN_LENGTH,
    instructions:
      'Using everything from this path, produce a small end-to-end analysis of sales data: choose the right method, show the output, explain what it means for a decision, and note one limitation.',
    criteria: [
      {
        id: 'excel-cap-method',
        label: 'Apply the appropriate method to the stated problem',
        groups: [
          ['sumifs', 'sum if', 'xlookup', 'vlookup', 'lookup', 'pivot', 'formula'],
        ],
      },
      {
        id: 'excel-cap-output',
        label: 'Show the resulting output or decision',
        groups: [['chart', 'summary', 'total', 'result', 'table']],
      },
      {
        id: 'excel-cap-meaning',
        label: 'Explain what the result means',
        groups: [['margin', 'profit', 'mean', 'average', 'because', 'shows']],
      },
      {
        id: 'excel-cap-limits',
        label: 'Identify an important limitation or assumption',
        groups: [['caveat', 'limit', 'assum', 'bias', 'check', 'verify']],
      },
    ],
  },
  web: {
    title: 'Final capability demonstration',
    minLength: CAPABILITY_MIN_LENGTH,
    instructions:
      'Using everything from this path, deliver a small working page: structured markup, deliberate styling, a visible result, and an explanation of one design decision and one limitation.',
    criteria: [
      {
        id: 'web-cap-build',
        label: 'Build the page with structured markup and styling',
        groups: [
          ['html', 'heading', 'section'],
          ['css', 'style', 'layout'],
        ],
      },
      {
        id: 'web-cap-outcome',
        label: 'Show the published result',
        groups: [['publish', 'share', 'link', 'deploy', 'live', 'page']],
      },
      {
        id: 'web-cap-decision',
        label: 'Explain one design decision and one limitation',
        groups: [
          ['responsive', 'mobile', 'choice', 'because', 'decide'],
          ['limit', 'browser', 'improve', 'next'],
        ],
      },
    ],
  },
  data: {
    title: 'Final capability demonstration',
    minLength: CAPABILITY_MIN_LENGTH,
    instructions:
      'Using everything from this path, run a small analysis on real-feeling data: apply the cleaning and analysis method, present the finding with a figure, interpret what it means, and state one caveat.',
    criteria: [
      {
        id: 'data-cap-method',
        label: 'Apply the cleaning and analysis method',
        groups: [
          ['clean', 'missing', 'duplicate'],
          ['average', 'total', 'summary', 'chart'],
        ],
      },
      {
        id: 'data-cap-finding',
        label: 'Present the finding with a supporting figure',
        groups: [
          ['finding', 'result', 'insight'],
          ['chart', 'figure', 'graph', 'visual'],
        ],
      },
      {
        id: 'data-cap-meaning',
        label: 'Explain what the finding means',
        groups: [['means', 'because', 'shows', 'insight', 'conclusion']],
      },
      {
        id: 'data-cap-caveat',
        label: 'State an important caveat on the finding',
        groups: [['caveat', 'limit', 'bias', 'assumption', 'caution']],
      },
    ],
  },
  generic: {
    title: 'Final capability demonstration',
    minLength: CAPABILITY_MIN_LENGTH,
    instructions:
      'Using everything from this path, complete a small real task: apply the method, show what was produced, explain what it demonstrates, and note what you would improve next.',
    criteria: [
      {
        id: 'gen-cap-apply',
        label: 'Apply the method to the task',
        groups: [['method', 'step', 'plan', 'approach', 'technique']],
      },
      {
        id: 'gen-cap-outcome',
        label: 'Show what was produced',
        groups: [['result', 'outcome', 'produce', 'complete', 'work']],
      },
      {
        id: 'gen-cap-reflect',
        label: 'Explain what it demonstrates and what is next',
        groups: [
          ['demonstrate', 'shows', 'means', 'learn'],
          ['next', 'improve', 'limitation', 'caveat'],
        ],
      },
    ],
  },
}

export function capabilityBrief(template: TemplateId): CapabilityBrief {
  return CAPABILITY_BRIEFS[template] ?? CAPABILITY_BRIEFS.generic
}

export interface CriterionResult {
  id: string
  label: string
  met: boolean
}

export interface StageAssessment {
  minLength: number
  criteria: StageCriterion[]
}

export function stageAssessment(
  template: TemplateId,
  stageId: string,
): StageAssessment {
  const stage = PATHS[template]?.stages.find((s) => s.id === stageId)
  return { minLength: PRACTICE_MIN_LENGTH, criteria: stage ? stage.criteria : [] }
}

export function evaluateCriteria(
  criteria: StageCriterion[],
  response: string,
): CriterionResult[] {
  const text = response.toLowerCase()
  return criteria.map((criterion) => ({
    id: criterion.id,
    label: criterion.label,
    met: criterion.groups.every((group) =>
      group.some((term) => text.includes(term)),
    ),
  }))
}

// Remediation focus (display prioritization only — never gating). Given the
// unmet criterion ids of the latest attempt plus remembered mastery rows,
// returns the ids to highlight under "Focus next on:": repeatedly struggling
// criteria first, otherwise all currently unmet criteria.
export function prioritizeRemediation(
  unmetIds: string[],
  mastery: { stageId: string; criterionId: string; consecutiveFailures: number }[],
  stageId: string,
): string[] {
  if (unmetIds.length === 0) return []
  const repeated = unmetIds.filter((id) =>
    mastery.some(
      (row) =>
        row.stageId === stageId &&
        row.criterionId === id &&
        row.consecutiveFailures >= 2,
    ),
  )
  return repeated.length > 0 ? repeated : [...unmetIds]
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
  stageId: string,
  response: string,
  attempt: number,
): PracticeEvaluation {
  const trimmed = response.trim()
  const { minLength, criteria } = stageAssessment(template, stageId)
  if (criteria.length === 0) {
    return {
      verdict: 'retry',
      strengths: ['You made an attempt — a good start.'],
      improvements: [
        'This activity has no defined requirements yet — try the practice again with more detail.',
      ],
      nextAction: 'Try the practice again, then submit.',
      results: [],
    }
  }
  const results = evaluateCriteria(criteria, trimmed)
  const met = results.filter((r) => r.met)
  const unmet = results.filter((r) => !r.met)
  if (unmet.length === 0 && trimmed.length >= minLength) {
    return {
      verdict: 'satisfactory',
      strengths: met
        .slice(0, 2)
        .map((r) => `You addressed "${r.label}".`),
      improvements: [
        'Keep this standard on the next stage: show your method, not just the answer.',
      ],
      nextAction: 'Continue to the next stage.',
      results,
    }
  }
  const improvements: string[] = []
  if (trimmed.length < minLength) {
    improvements.push(
      `Your response is quite short (${trimmed.length} characters). Aim for at least ${minLength} characters explaining what you did and why.`,
    )
  }
  for (const r of unmet.slice(0, 2)) {
    improvements.push(`Not yet addressed: ${r.label}.`)
  }
  if (attempt >= 2) {
    return {
      verdict: 'remedial',
      strengths:
        met.length > 0
          ? [`You addressed "${met[0].label}" — build on that.`]
          : ['You attempted the task — that is the right starting point.'],
      improvements: [
        ...improvements,
        'Remedial hint: take each requirement under "For a satisfactory response" in turn and give it a sentence or two. Keep practising — submit again when ready.',
      ],
      nextAction: 'Practise again with the hints above, then submit.',
      results,
    }
  }
  return {
    verdict: 'retry',
    strengths:
      met.length > 0
        ? [`You addressed "${met[0].label}" — keep going.`]
        : ['You made an attempt — a good start.'],
    improvements,
    nextAction: 'Try the practice again, then submit.',
    results,
  }
}

export function capabilityTask(
  template: TemplateId,
  goalText: string,
  outcome: string,
): CapabilityTask {
  const brief = capabilityBrief(template)
  return {
    title: brief.title,
    instructions: `Show what you can now do. Goal: ${goalText.trim()} Expected outcome: ${outcome} ${brief.instructions} Aim for at least ${CAPABILITY_MIN_LENGTH} characters.`,
  }
}

export function evaluateCapability(
  template: TemplateId,
  outcome: string,
  response: string,
): CapabilityEvaluation {
  const trimmed = response.trim()
  const brief = capabilityBrief(template)
  const results = evaluateCriteria(brief.criteria, trimmed)
  const met = results.filter((r) => r.met)
  const unmet = results.filter((r) => !r.met)
  const satisfactory =
    unmet.length === 0 && trimmed.length >= CAPABILITY_MIN_LENGTH
  const strengths = satisfactory
    ? met
        .slice(0, 2)
        .map((r) => `You demonstrated "${r.label}".`)
    : met.length > 0
      ? [`You demonstrated "${met[0].label}" — extend this across the whole task.`]
      : ['You described an attempt — now connect it to the outcome.']
  const improvements = satisfactory
    ? ['Keep a copy of this work as portfolio evidence.']
    : [
        ...(trimmed.length < CAPABILITY_MIN_LENGTH
          ? [
              `Aim for at least ${CAPABILITY_MIN_LENGTH} characters describing what you produced and what it demonstrates.`,
            ]
          : []),
        ...unmet
          .slice(0, 2)
          .map((r) => `Not yet demonstrated: ${r.label}.`),
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
