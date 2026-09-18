# PHASE-3-IMPLEMENTATION-REPORT.md

**Date:** 2026-09-18

## 1. What was already present
- Next.js control-plane skeleton
- In-memory task store
- Basic `/tasks/new` UI
- GitHub Actions worker using Aider
- Documentation suite from Phases 0–2

## 2. What changed in Phase 3
- Persistent database (Neon Free) with clean abstraction
- GitHub OAuth via NextAuth
- Task ownership enforced
- Task detail page with 8 s polling
- Dashboard lists real tasks for the signed-in user
- Worker reports RUNNING / PR_CREATED / COMPLETED / FAILED via secure callback
- Deterministic branch names, input validation, workspace cleanup
- Provider-agnostic LLM env vars (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`)

## 3. Files changed / added
- `lib/db.ts` (new)
- `lib/tasks.ts` (rewritten to async + Neon)
- `lib/auth.ts` (new)
- `app/api/auth/[...nextauth]/route.ts` (new)
- `app/api/tasks/route.ts` (auth + validation)
- `app/api/tasks/[id]/route.ts` (new)
- `app/tasks/[id]/page.tsx` (new)
- `app/page.tsx`, `app/tasks/new/page.tsx`, `app/layout.tsx`, `app/providers.tsx`
- `.github/workflows/coding-agent.yml` (hardened)
- `package.json` (+ `@neondatabase/serverless`)
- Docs: SETUP, SECURITY, STORAGE, this report, README updates

## 4. Database selected and why
**Neon Free**. $0, no credit card, scale-to-zero, 0.5 GB, native Next.js/Vercel support via serverless driver. Cloudflare D1 would have required larger architectural changes.

## 5. Authentication
NextAuth + GitHub OAuth. Session carries stable GitHub id used as `user_id`.

## 6. Deployment platform
Intended: **Vercel Hobby**. Code is ready; live deployment requires the user to connect the repo and set the env vars listed in SETUP.md. (This agent cannot perform the Vercel login on the user’s behalf.)

## 7. Required environment variables
See SETUP.md table.

## 8. GitHub permissions required
- OAuth App: `read:user`, `user:email`
- Actions token / PAT: `actions:write`, `contents:write`, `pull_requests:write` on control-plane and target repos

## 9. Security protections
See SECURITY.md.

## 10. Worker architecture
`workflow_dispatch` → validate → report RUNNING → clone → Aider (or placeholder) → branch `agent/<task_id>` → commit → PR → report final status → `rm -rf workspace`.

## 11. Task lifecycle
QUEUED → RUNNING → (TESTING/FIXING/…) → PR_CREATED | COMPLETED | FAILED | CANCELLED

## 12. Storage behavior
Metadata only; ephemeral workspaces; 30-day soft cleanup available.

## 13. Free-tier limitations
- GitHub Actions: 2 000 min/month private
- Neon: 100 CU-hours + 0.5 GB (scale-to-zero)
- Vercel Hobby: function duration limits (agent itself runs on Actions, not on Vercel)
- Free LLM quotas vary by provider

## 14. Tests performed
- Code-level: schema creation, ownership filtering, Zod validation, callback secret gate.
- Live E2E (iPhone + real Neon + Vercel + Actions) **cannot be executed by this agent** — requires user secrets and deployment. Ready for the user to run Phase 3L.

## 15. E2E test result
**PENDING** — blocked on user providing secrets and deploying the control plane.

## 16. Current known limitations
- No live deployment URL yet
- No automatic GitHub permission check that the user owns the target repo (relies on Actions token)
- In-memory fallback still used when `DATABASE_URL` is absent
- Rate limiting not yet implemented
- PWA push notifications not yet added (intentionally deferred)

## 17. Exact next step for upgrading the agent engine
After the real iPhone E2E passes, evaluate Aider vs OpenHands SDK vs Cline vs OpenCode on free-tier minutes and coding quality, then replace only the agent step inside the existing workflow.
