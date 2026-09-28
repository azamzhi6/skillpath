# SkillPath prototype (local)

**Status: Phase 3 — Progress Persistence & Data Layer is implemented.**
Next planned phase: **Phase 4 — Prototype Hardening & Handoff** (not implemented).

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
Progress persists in local SQLite via the thin Express API (`storage.ts`
adapter seam); browser localStorage (`skillpath.prototype.v1`) is kept only as
an offline fallback and as the one-time migration source.

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
- API down (stop `dev:api`) → “Using offline copy (API unreachable).”,
  flow keeps working; restart API → saves resume.
- Malformed `PUT` body → JSON 400 (`Invalid state snapshot` / `Invalid JSON`).
- `DELETE /api/state` → `GET` returns `{ "state": null }`.

## Known limitations

- Single demo learner and single active goal; no accounts.
- Deterministic mock coach (4 templates); no real AI.
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
