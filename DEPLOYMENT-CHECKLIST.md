# DEPLOYMENT-CHECKLIST.md

Check each box as you complete it. Do not skip steps.

## Accounts

- [ ] Neon account created (https://console.neon.tech)
- [ ] GitHub account (already have)
- [ ] Vercel account (https://vercel.com — sign in with GitHub is fine)
- [ ] Free LLM provider account (Groq / Gemini / OpenRouter / …)

## Values you create (never paste into the repo or chat)

- [ ] Neon connection string copied
- [ ] GitHub OAuth App created; Client ID and Client Secret copied
- [ ] `NEXTAUTH_SECRET` generated locally (`openssl rand -base64 32`)
- [ ] `WORKER_CALLBACK_SECRET` generated locally (`openssl rand -base64 24`)
- [ ] Fine-grained PAT created with Actions + Contents + Pull requests write
- [ ] LLM API key obtained

## Vercel

- [ ] Project imported from `shukanwadhawana-cloud/Personal-AI-bot`
- [ ] Env var `DATABASE_URL` set (Production)
- [ ] Env var `NEXTAUTH_SECRET` set (Production)
- [ ] Env var `GITHUB_ID` set (Production)
- [ ] Env var `GITHUB_SECRET` set (Production)
- [ ] Env var `AGENT_GITHUB_TOKEN` set (Production)
- [ ] Env var `WORKER_CALLBACK_SECRET` set (Production)
- [ ] First deploy completed; production domain noted
- [ ] Env var `NEXTAUTH_URL` = `https://YOUR-DOMAIN.vercel.app`
- [ ] Env var `CALLBACK_URL` = `https://YOUR-DOMAIN.vercel.app/api/tasks`
- [ ] Redeployed after setting domain-dependent vars

## GitHub OAuth App (after domain known)

- [ ] Homepage URL updated to `https://YOUR-DOMAIN.vercel.app`
- [ ] Authorization callback URL updated to `https://YOUR-DOMAIN.vercel.app/api/auth/callback/github`

## GitHub Actions secrets (this repository)

- [ ] Secret `LLM_API_KEY` set
- [ ] Secret `WORKER_CALLBACK_SECRET` set (same value as Vercel)
- [ ] Optional: `LLM_BASE_URL` set
- [ ] Optional: `LLM_MODEL` set

## First iPhone test

- [ ] Open production URL in Safari on iPhone
- [ ] Sign in with GitHub succeeds
- [ ] Create task with the safe README-only prompt from SETUP.md
- [ ] Redirected to `/tasks/<id>` and status becomes RUNNING
- [ ] Lock phone / leave Safari
- [ ] Wait for worker (3–15 min)
- [ ] Reopen app → task still exists and status progressed
- [ ] GitHub shows branch `agent/<task-id>` and a PR

## If something fails

- Sign-in error → check OAuth callback URL and `NEXTAUTH_URL` / `NEXTAUTH_SECRET`
- Task stays QUEUED forever → check `AGENT_GITHUB_TOKEN` can dispatch workflows; check Actions tab for a run
- Worker fails → check Actions logs and `LLM_API_KEY`
- Status never updates after worker → check `CALLBACK_URL` and matching `WORKER_CALLBACK_SECRET` in both places
- “DATABASE_URL is required in production” → Neon string missing or not applied to Production env
