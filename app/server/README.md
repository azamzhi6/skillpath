# SkillPath prototype API + database (Phase 3)

Thin local Express API backed by a local SQLite file (`better-sqlite3`).
No auth, no cloud, no AI calls, no deployment.

**Status: Phase 3 — Progress Persistence & Data Layer is implemented.**
Next planned phase: **Phase 4 — Prototype Hardening & Handoff** (not implemented).

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

## Endpoints

- `GET /api/health` → `{ ok: true }`
- `GET /api/state` → `{ state: <journey snapshot> | null }`
- `PUT /api/state` ← `{ state: <journey snapshot> }` (upsert in one transaction)
- `DELETE /api/state` → clears the demo journey

## Notes

- The database directory `app/server/data/` is gitignored; the `.db` file is
  local demo data only and is never committed.
- If `better-sqlite3` ever fails to load in a new Node environment, do not
  silently swap drivers — record the exact error and steer first.
