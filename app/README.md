# SkillPath prototype (local)

**Status: Phases 3–5 implemented; Phase 6A–6C implemented (Real-AI Learn
content via Groq with deterministic mock fallback).**
Next planned work: **Phase 6D+** (not implemented).

Working SkillPath page with mock coaching logic. Persistence is a thin local
Express API backed by SQLite (`better-sqlite3`); browser localStorage remains
only as an offline fallback. No account, no external services.

## Run locally

Requires **Node.js >= 24 LTS** (tested on v26.7.0; see `engines` in
`package.json`). On Windows use `npm.cmd` (execution policy blocks `npm.ps1`).

Frontend only (offline localStorage copy is used when the API is down):

```powershell
Set-Location "C:\Users\IBRAHIM\Desktop\SkillPath\app"
npm.cmd install
npm.cmd run dev
```

API only:

```powershell
npm.cmd run dev:api
```

Both together (two terminals, either order):

```powershell
npm.cmd run dev:api
npm.cmd run dev
```

Open http://localhost:5173 in a browser.
API health: http://localhost:5174/api/health.
Database file: `app/server/data/skillpath.db` (gitignored, created on first run).

## Flow

Goal → Clarification → Quick diagnostic → Personalised path → Next action.
Open any stage for the learning loop: Learn → Practise → Submit → Feedback →
Retry/Continue → next stage. After all stages are satisfactory, a final
capability demonstration records persistent evidence of ability.
Progress persists in local SQLite via the thin Express API (`storage.ts`
adapter seam); browser localStorage (`skillpath.prototype.v1`) is kept only as
an offline fallback and as the one-time migration source.

## Learning loop (Phase 5)

- Each path stage opens a Learn view (objective, content, worked example,
  resource) derived from the existing stage data — no content system.
- Practice is a text response (no uploads). Submitting persists the attempt;
  the deterministic `mockCoach` evaluator returns satisfactory / retry /
  remedial with strengths, improvements and a next action.
- Satisfactory practice auto-completes the stage. A second failed attempt
  produces remedial hints; the learner can always keep practising.
- Manual stage checkboxes remain only as a prototype override — they do not
  unlock capability demonstration. Capability unlocks only when every stage
  has a satisfactory practice result.
- The final capability task is evaluated deterministically; success writes a
  `capability_evidence` row (multiple demonstrations per goal are allowed;
  the UI shows the latest).

## Real-AI Learn content (Phase 6A–6C, Groq)

- Opening a stage requests AI-generated Learn text from `POST /api/learn`.
  Without `GROQ_API_KEY` (or when Groq fails/times out), the existing
  deterministic content renders with no label change.
- AI content is labelled “AI-generated — verify with authoritative sources”.
- Setup: copy `app/.env.example` to `app/.env`, set `GROQ_API_KEY`, restart
  the API (`npm.cmd run dev:api`). Never commit `.env`.
- Evaluation, verdicts, retry/remedial rules and evidence logic remain fully
  deterministic — AI generates teaching prose only.

## Build check

```powershell
npm.cmd run build
```

## Fresh setup (new machine)

1. Install Node.js 24 LTS or newer.
2. Clone the repository.
3. `Set-Location app` then `npm.cmd install`.
4. Approve install scripts (npm v11+ blocks them otherwise):
   `npm.cmd install-scripts approve esbuild better-sqlite3`
5. `npm.cmd run dev:api` — creates and seeds `server/data/skillpath.db`
   automatically on first start; no manual database step exists.
6. `npm.cmd run dev` (second terminal).
7. Open http://localhost:5174/api/health → expect `{ "ok": true }`.
8. Open http://localhost:5173 and run the journey: goal → clarification →
   diagnostic → path → tick a stage done.
9. Hard-refresh the browser → goal, path and completed stage remain.
10. Reset demo → journey clears.

## Testing checklist

- `npm.cmd run build` (strict `tsc` incl. server + `vite build`).
- Empty goal shows an error and stays put; 1–3 character goals stay
  local-only and never flip a healthy API offline.
- Partial diagnostic + refresh resumes at the diagnostic step.
- Learning loop: open a stage → Learn renders → Practice renders → enter a
  response → submit persists → weak response retries → second failure shows
  remedial hints → good response completes the stage and advances Next Action.
- Ticking checkboxes alone never unlocks capability demonstration.
- Complete all stages satisfactorily → capability task appears → submit →
  evidence banner appears and survives API restart.
- API down (stop `dev:api`) → “Using offline copy (API unreachable).”,
  flow keeps working; restart API → saves resume.
- Malformed `PUT` body → JSON 400 (`Invalid state snapshot` / `Invalid JSON`).
- `DELETE /api/state` → `GET` returns `{ "state": null }`.

## Known limitations

- Single demo learner and single active goal; no accounts.
- Deterministic mock coach (4 templates) and mock evaluation; no real AI.
- Submitting needs the local API; offline mode keeps the journey readable
  but disables Submit (no offline queue).
- Browser mirror is a fallback copy, not a sync protocol.
- `vite preview` serves the build without the `/api` proxy, so it runs in
  offline mode by design.

## Troubleshooting

- `npm.ps1 cannot be loaded` → use `npm.cmd` on Windows.
- Vite/esbuild missing binary after install → approve scripts (step 4) and
  reinstall; do NOT `npm rebuild better-sqlite3` without Python + build tools.
- Port in use → stop the other process or set `PORT` (API) before `dev:api`.
- `skillpath.db` locked/corrupt → API exits with the file path in the message;
  delete `server/data/` to start fresh (demo data only).

## Mocked vs future

Mocked now: coach responses, scoring, resources, authentication (demo
learner), resource discovery. Future MVP/production would add: real auth,
multi-learner goals, Postgres/Docker/cloud, admin, analytics — none of that
is in this prototype.
