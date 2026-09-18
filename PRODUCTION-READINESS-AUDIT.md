# PRODUCTION-READINESS-AUDIT.md

**Audit date:** 2026-09-18  
**Repository commit at audit start:** a901c94  
**Fixes applied in this pass:** hard-fail without DATABASE_URL in production, CALLBACK_URL construction, prompt via env, PATCH field restrictions.

---

## 1. Environment variables / secrets

| Name | Used by | Plane | Required | Where configured | Browser? | Sensitivity | Example format |
|------|---------|-------|----------|------------------|----------|-------------|----------------|
| `DATABASE_URL` | lib/db.ts | Control plane | **Yes (prod)** | Vercel env | No | High | `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require` |
| `NEXTAUTH_SECRET` | next-auth | Control plane | **Yes** | Vercel env | No | High | 32+ random bytes base64 |
| `NEXTAUTH_URL` | next-auth | Control plane | **Yes** | Vercel env | No | Low | `https://your-app.vercel.app` |
| `GITHUB_ID` | next-auth GitHub provider | Control plane | **Yes** | Vercel env | No | Medium | OAuth App Client ID |
| `GITHUB_SECRET` | next-auth GitHub provider | Control plane | **Yes** | Vercel env | No | High | OAuth App Client Secret |
| `GITHUB_TOKEN` / `AGENT_GITHUB_TOKEN` | /api/tasks dispatch | Control plane | **Yes** for dispatch | Vercel env | No | High | `ghp_…` or fine-grained PAT |
| `CONTROL_PLANE_REPO` | /api/tasks | Control plane | Optional | Vercel env | No | Low | `owner/repo` |
| `CALLBACK_URL` | /api/tasks | Control plane | Recommended | Vercel env | No | Low | `https://your-app.vercel.app/api/tasks` (base; task id is appended) |
| `WORKER_CALLBACK_SECRET` | /api/tasks/[id] + Actions | Both | Recommended | Vercel **and** Actions secrets | No | High | random 32+ char string |
| `LLM_API_KEY` | Actions worker | Worker | Yes for real agent | **GitHub Actions secrets** | No | High | provider key |
| `LLM_BASE_URL` | Actions worker | Worker | Optional | Actions secrets | No | Low | `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | Actions worker | Worker | Optional | Actions secrets | No | Low | `llama-3.1-70b-versatile` |
| `GITHUB_TOKEN` (auto) | Actions | Worker | Auto-provided | Actions | No | High | (system) |

No other `process.env.*` references exist in the application code.

---

## 2. Database (Neon)

- Parameterized queries only (neon tagged templates).
- Indexes on user_id, status, updated_at, (user_id, status).
- Ownership enforced on every read/update when userId is supplied.
- **Production change:** missing `DATABASE_URL` now throws; memory fallback is development-only.
- Schema auto-created on first use.
- Scale-to-zero after 5 min idle is acceptable (first request after idle may be slower).

---

## 3. Authentication

- All task routes call `requireUser()` and return 401 if absent.
- No remaining `demo-user` strings (repo-wide search: 0 hits).
- Session carries stable GitHub numeric id as `user.id`.
- Secrets never imported into client components.
- `useSecureCookies` enabled when `NODE_ENV=production`.

---

## 4. Task API

- POST: auth + Zod (repo format, prompt length) + persistent write + dispatch.
- GET list / GET by id: auth + ownership.
- PATCH: worker path (shared secret) can set status/result/commit/PR; user path may only CANCEL or WAITING_FOR_INPUT and cannot set commit/PR fields.
- Protected fields (userId, createdAt, id) are never accepted from body.

---

## 5. Worker security

- Prompt passed via environment variable (`TASK_PROMPT`) and `--message-file /dev/stdin` — avoids shell injection from expression interpolation.
- Repository name and task_id validated with strict character classes before use.
- Branch name derived only from validated task_id.
- LLM key, callback secret, and GITHUB_TOKEN are Actions secrets; never written into the cloned workspace.
- Permissions: `contents: write`, `pull-requests: write` only.
- Timeout 90 minutes.
- Workspace deleted with `rm -rf` even on failure.
- Final status always reported when callback_url is present.

---

## 6. State machine

QUEUED → RUNNING (on successful dispatch) → PR_CREATED | COMPLETED | FAILED (worker callback).

Users can only set CANCELLED / WAITING_FOR_INPUT.

No full heartbeat/lease yet; if the worker crashes before the final callback the task can remain RUNNING. Smallest mitigation still TODO: a scheduled job that marks RUNNING tasks older than N hours as FAILED. Documented as known limitation.

---

## 7. Free-tier safety

- Single job, 90 min hard timeout, no loops, no artifacts uploaded.
- Compatible with 2 000 free Actions minutes/month.

---

## 8. Build / deployment readiness

- No filesystem assumptions beyond the Actions runner.
- Server-only packages (`@neondatabase/serverless`, next-auth server helpers) are only imported from server routes / lib used by server routes.
- Live Vercel deploy + Neon project + secrets are still required from the user.

---

## 9. Known remaining limitations (honest)

1. Live deployment and iPhone E2E cannot be executed by this agent.
2. No automatic “RUNNING tasks older than X hours → FAILED” sweeper yet.
3. No GitHub API check that the signed-in user actually has write access to the target repository (relies on the Actions token failing if it does not).
4. Rate limiting on task creation not implemented.
