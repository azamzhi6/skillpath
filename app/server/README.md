# SkillPath prototype API + database (Phase 3)

Thin local Express API backed by a local SQLite file (`better-sqlite3`).
No auth, no cloud, no AI calls, no deployment.

**Status: Phase 3 — Progress Persistence & Data Layer is implemented.**
Next planned phase: **Phase 4 — Prototype Hardening & Handoff** (not implemented).

## Node version

- Supported minimum: **Node.js >= 24** (see `engines` in `app/package.json`).
  The server runs TypeScript directly via Node's native type-stripping, which
  needs Node >= 23.6 unflagged; 24 LTS is the conservative baseline.
  `better-sqlite3@13` requires Node >= 22; Express 5 requires Node >= 18.
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
- Database file: `app/server/data/skillpath.db` (gitignored, created on first run)

## Database initialization

No manual step is required. On first API start the server creates
`app/server/data/`, applies `schema.sql` (5 tables: learners, goals,
diagnostics, paths, progress) and seeds the `demo-learner` record.
If the database cannot be opened, the API exits with a clear error message.

## Endpoints

- `GET /api/health` → `{ ok: true }`
- `GET /api/state` → `{ state: <journey snapshot> | null }`
- `PUT /api/state` ← `{ state: <journey snapshot> }` (validated, upsert in one transaction; 400 on invalid payload or malformed JSON)
- `DELETE /api/state` → clears the demo journey

## Fresh-install notes (Windows)

- On Windows use `npm.cmd` (PowerShell execution policy blocks `npm.ps1`).
- npm v11+ blocks install scripts until approved. After `npm install`, run:
  `npm.cmd install-scripts approve esbuild better-sqlite3`
- Do NOT run `npm rebuild better-sqlite3`: without Python + build tools the
  source compile fails. The downloaded prebuilt binary is all that is needed —
  verify with `node -e "require('better-sqlite3')(':memory:')"` instead.

## Notes

- The database directory `app/server/data/` is gitignored; the `.db` file is
  local demo data only and is never committed.
- If `better-sqlite3` ever fails to load in a new Node environment, do not
  silently swap drivers — record the exact error and steer first.
