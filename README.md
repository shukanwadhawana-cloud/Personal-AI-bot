# Personal AI Bot — Persistent Cloud Coding Agent

> Evolve into a mobile-controllable, always-continuing coding agent (OpenHands-style) that survives phone lock, browser close, and network loss. Target cost: **₹0/month**.

## Foundation Chosen (Phase 1)

**PRIMARY:** OpenHands concepts + Software Agent SDK patterns + GitHub Actions as the free, isolated, long-running execution sandbox.

**Architecture (simplified):**

```
iPhone / iPad (PWA)
      ↓
Thin Control Plane (this repo — Next.js / API)
      ↓
Persistent Task State (free DB)
      ↓
GitHub Actions workflow_dispatch / repository_dispatch
      ↓
Ephemeral runner + coding agent (OpenHands-compatible loop / Aider / Cline headless)
      ↓
Clone target repo → observe → plan → edit → test → fix → branch → commit → PR
      ↓
Result + status written back → notification
```

The phone never keeps the task alive. The cloud (Actions) does.

## Status

- Phase 0 (Audit): Complete
- Phase 1 (Foundation): Chosen — OpenHands-inspired agent loop + GitHub Actions execution + thin control plane
- Phase 2 (Implement): In progress in this repository
- Phase 3 (E2E test): Pending after core wiring

## Quick Start (after secrets are set)

1. Fork / use this repo.
2. Add secrets: `LLM_API_KEY` (Groq / Gemini / OpenRouter free), optional `OPENHANDS` tokens if using full SDK.
3. Deploy control plane to Vercel Hobby (or Cloudflare).
4. From the mobile UI: select a target repository you own, enter a prompt, start task.
5. Lock phone → task continues on Actions → reopen to see status / PR link.

## Documentation

- CURRENT-ARCHITECTURE.md
- OPEN-SOURCE-AUDIT.md
- LICENSE-AUDIT.md
- FREE-INFRASTRUCTURE-AUDIT.md
- REQUIRED-ACCOUNTS.md
- SETUP.md (to be expanded)
- SECURITY.md (to be expanded)
- STORAGE.md (to be expanded)

## License

MIT (this control plane). Upstream agents retain their own licenses (MIT / Apache-2.0).
