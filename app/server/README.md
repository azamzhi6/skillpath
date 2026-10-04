# SkillPath API + database

Thin Express API backed by PostgreSQL (`pg` pool). No auth, no cloud
(except the database host), no AI calls except optional Groq.

**Status: Phases 3–5 implemented; Phase 6A–6C implemented (Real-AI Learn
content via Groq with deterministic mock fallback).**
Next planned work: **Phase 6D+** (not implemented).

## Node version

- Supported minimum: **Node.js >= 24** (see `engines` in `app/package.json`).
  The server runs TypeScript directly via Node's native type-stripping, which
  needs Node >= 23.6 unflagged; 24 LTS is the conservative baseline.
  `pg` requires Node >= 18; Express 5 requires Node >= 18.
- Tested version: **Node.js v26.7.0**.

## Run

Frontend only (uses offline localStorage copy when the API is down):

```powershell
npm.cmd run dev
```

API only:

```powershell
npm.cmd run dev:api
```

Both together (two terminals — frontend first or API first, either order):

```powershell
npm.cmd run dev:api
npm.cmd run dev
```

- Frontend: http://localhost:5173
- API health: http://localhost:5174/api/health
- Database: PostgreSQL via `NETLIFY_DATABASE_URL` (production) or
  `DATABASE_URL` (local development); schema is created automatically.

## Database initialization

No manual schema step is required. On first API start the server applies
`schema.sql` (learners, goals, diagnostics, paths, progress, submissions,
feedback, capability_evidence, learner_criterion_mastery) and seeds the
`demo-learner` record. Set `NETLIFY_DATABASE_URL` (production) or
`DATABASE_URL` (local development) to a PostgreSQL connection string first —
without one the API exits with a clear error message.

## Endpoints

- `GET /api/health` → `{ ok: true }`
- `GET /api/state` → `{ state: <journey snapshot> | null, learning: { submissions[], feedback[], evidence[] } }`
- `PUT /api/state` ← `{ state: <journey snapshot> }` (validated, upsert in one transaction; 400 on invalid payload or malformed JSON)
- `DELETE /api/state` → clears the demo journey including learning-loop rows
- `POST /api/submissions` ← `{ stageId, kind, response, verdict, strengths, improvements, nextAction, evidence? }` → `{ submission: { id, attempt }, feedback: { verdict, strengths, improvements, nextAction, proseSource }, evidenceId }` (attempt assigned server-side; deterministic verdict stored verbatim; when Groq is configured the prose fields are AI rewordings validated server-side with `proseSource: 'ai'`, otherwise the deterministic text with `'mock'`; one transaction per write; 400 on invalid payload or missing journey)
- `POST /api/learn` ← `{ goalText, outcome, stageTitle, stageKind, stageDescription, practiceTask, level }` → `{ source: 'ai', explanation, example }` or `{ source: 'mock' }` (validated; AI failures fall back to mock, never to learner-facing errors)
- `POST /api/goal-parse` ← `{ goalText }` (4–500 chars) → `{ source: 'ai', parsed: { subject ≤120, desiredOutcome ≤300, timeframe enum } }` or `{ source: 'mock', parsed: null }` (extraction only — never validates, scores, or judges the goal; 400 on invalid request)

## Real AI (Groq, Phase 6A–6C)

- The app depends on the `AiProvider` interface (`server/ai/provider.ts`), not
  on Groq directly. `GroqProvider` (`server/ai/groq.ts`) is selected only when
  `GROQ_API_KEY` is set; otherwise Learn content falls back to deterministic
  templates with no label change.
- Configuration (all optional except the key): `GROQ_MODEL`
  (default `llama-3.3-70b-versatile`), `GROQ_BASE_URL` (default Groq cloud),
  `GROQ_TIMEOUT_MS` (default 25000). Copy `app/.env.example` to `app/.env`
  locally — `.env` is gitignored and the key is server-side only (never
  logged, never sent to the browser).
- Prompt `v1` lives in `server/ai/prompts.ts`; Learn responses are validated
  in `server/ai/validate.ts` (non-empty strings, 1200/800 char caps).
- No `ai_cache` table: Learn content is personalised per goal/outcome, so a
  goal-independent cache key would serve identical text to different learners.
  Each stage open performs at most one AI call (~3 per journey); this keeps
  slice 1 simple instead of over-engineered.

## Real-AI feedback prose (R1)

- Deterministic verdicts stay authoritative: the client evaluates with
  `mockCoach`, the server stores that verdict verbatim, and AI only rewords
  strengths/improvements/nextAction (prompt `v1` requires preserving meaning).
- Stored rows carry `prose_source` (`'ai'` or `'mock'`); pre-R1 rows read as
  `'mock'` via column default plus migration. The UI labels AI prose and never
  mislabels mock prose.

## Learner Model Milestone 1

- The deterministic evaluator decides results; `learner_criterion_mastery`
  only remembers per-criterion pass/fail history (attempts, passes, failures,
  consecutive failures, last result, mastery status). It is never consulted
  by any verdict, completion, capability, or evidence logic.
- `POST /api/submissions` accepts additive `criteria: [{ criterionId, met }]`
  plus `template`; IDs are validated against the submitted stage and unknown
  IDs reject the submission. The mastery update runs in the same transaction
  as the submission insert. `GET /api/state` returns current `mastery` rows;
  reset clears them with everything else.

## Fresh-install notes (Windows)

- On Windows use `npm.cmd` (PowerShell execution policy blocks `npm.ps1`).
- npm v11+ blocks install scripts until approved. After `npm install`, run:
  `npm.cmd install-scripts approve esbuild`
- Local development needs PostgreSQL running and `DATABASE_URL` set (see
  Fresh setup in `app/README.md`); `npm run test:db` uses pg-mem and needs
  no database.

## Notes

- Learner data lives in PostgreSQL in every environment; there is no local
  database file. Set `NETLIFY_DATABASE_URL` (or `DATABASE_URL` locally) —
  the server fails fast with a clear message when it is missing.

## Production deploy (Netlify)

- Connect the repository, base directory `app`. Build command:
  `npm install && npm run build && npm run build:function`; publish
  directory `dist`; functions directory `netlify/functions` (see
  `netlify.toml` at the repo root). `build:function` pre-bundles the `api`
  function as ESM from `netlify/src/api.mts` (deployed with
  `node_bundler = "none"`); only generated outputs ever live in
  `netlify/functions`.
- Node version: 24 (`NODE_VERSION=24`).
- Add the Netlify database integration and expose its connection string as
  `NETLIFY_DATABASE_URL`. Tables are created automatically on first start.
- Optional `GROQ_API_KEY` (without it the app runs in deterministic mock
  mode, exactly as locally). AI calls time out after ~8s to fit serverless
  execution limits; any AI failure falls back to deterministic content.
- Health check: `GET /api/health`. Netlify serves the built React app from
  its CDN; `/api/*` routes to the single `api` function wrapping the
  existing Express application.
