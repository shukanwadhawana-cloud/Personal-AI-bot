# Personal AI Bot — Persistent Cloud Coding Agent

> Mobile-controllable coding agent that continues after you lock your iPhone. Target cost: **₹0/month**.

## Current status (Phase 3)

| Component | Status |
|-----------|--------|
| Control plane (Next.js) | Implemented |
| Persistent DB (Neon Free) | Implemented |
| GitHub OAuth | Implemented |
| Task detail + polling | Implemented |
| GitHub Actions worker | Hardened |
| Live deployment | Ready — needs your secrets + Vercel connect |
| Real iPhone E2E | Pending deployment |

## Architecture

```
iPhone / iPad (PWA)
      ↓
Next.js control plane (Vercel Hobby)
      ↓
Neon Free (task metadata only)
      ↓
GitHub Actions workflow_dispatch
      ↓
Ephemeral runner + Aider (OpenHands/Cline later)
      ↓
clone → edit → test → branch → commit → PR → cleanup
      ↓
status written back to Neon → visible on /tasks/[id]
```

## Quick start

See **SETUP.md** for the exact environment variables and deployment steps.

## Documentation

- SETUP.md
- SECURITY.md
- STORAGE.md
- PHASE-3-IMPLEMENTATION-REPORT.md
- FINAL-REPORT.md
- OPEN-SOURCE-AUDIT.md / LICENSE-AUDIT.md / FREE-INFRASTRUCTURE-AUDIT.md / REQUIRED-ACCOUNTS.md

## License

MIT (control plane). Upstream agents keep their own licenses.
