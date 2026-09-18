# Personal AI Bot — Persistent Cloud Coding Agent

Mobile-controllable coding agent that continues after you lock your iPhone.  
**Target cost: ₹0/month.**

## Status (after production-readiness pass)

| Component | Status |
|-----------|--------|
| Control plane (Next.js) | Ready |
| Neon Free persistence | Ready (hard-fails in prod without DATABASE_URL) |
| GitHub OAuth | Ready |
| Task detail + polling | Ready |
| Hardened Actions worker | Ready |
| Live deployment | **Requires your Neon + Vercel + secrets** |
| Real iPhone E2E | **Blocked on user configuration** |

## Architecture

```
iPhone / iPad (PWA)
      ↓
Next.js on Vercel Hobby
      ↓
Neon Free (task metadata only)
      ↓
GitHub Actions (workflow_dispatch)
      ↓
Ephemeral runner + Aider
      ↓
clone → edit → branch → commit → PR → cleanup
      ↓
status callback → Neon → visible on /tasks/[id]
```

## Setup

Follow **SETUP.md** exactly. It separates Vercel environment variables from GitHub Actions secrets and includes a safe first test prompt.

## Documentation

- SETUP.md — deployment sequence
- PRODUCTION-READINESS-AUDIT.md — env vars, security, known limitations
- SECURITY.md / STORAGE.md
- PHASE-3-IMPLEMENTATION-REPORT.md

## License

MIT (control plane).
