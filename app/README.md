# SkillPath prototype (local)

Initial working page for the incubator assessment. Mock coaching logic only —
no backend, no account, no external services.

## Run locally

Requires Node.js + npm on PATH.

```powershell
Set-Location "C:\Users\IBRAHIM\Desktop\SkillPath\app"
npm.cmd install
npm.cmd run dev
```

Open http://localhost:5173 in a browser.

## Flow

Goal → Clarification → Quick diagnostic → Personalised path → Next action.
Progress persists in browser localStorage (`skillpath.prototype.v1`); the
`storage.ts` adapter seam is where the planned SQLite backend plugs in (Phase 3).

## Build check

```powershell
npm.cmd run build
```
