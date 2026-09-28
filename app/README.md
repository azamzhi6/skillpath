# SkillPath prototype (local)

**Status: Phase 3 — Progress Persistence & Data Layer is implemented.**
Next planned phase: **Phase 4 — Prototype Hardening & Handoff** (not implemented).

Working SkillPath page with mock coaching logic. Persistence is a thin local
Express API backed by SQLite (`better-sqlite3`); browser localStorage remains
only as an offline fallback. No account, no external services.

## Run locally

Requires Node.js + npm on PATH.

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
