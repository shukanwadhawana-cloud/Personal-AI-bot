# SETUP.md — Exact steps for ₹0 operation

## 1. GitHub OAuth App (for user login)

1. Go to https://github.com/settings/developers → OAuth Apps → New.
2. Homepage URL: your deployed control-plane URL (e.g. https://personal-ai-bot.vercel.app).
3. Authorization callback: `https://<your-domain>/api/auth/callback/github`.
4. Copy Client ID → `GITHUB_ID`.
5. Generate Client Secret → `GITHUB_SECRET`.

## 2. Neon Free database (task persistence)

1. Create a free project at https://neon.tech (no credit card required).
2. Copy the connection string → `DATABASE_URL`.
3. Schema is auto-created on first API call (`ensureSchema`).

## 3. Secrets for the control-plane host (Vercel recommended)

| Variable | Required | Purpose |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Neon connection string |
| `NEXTAUTH_SECRET` | Yes | Random 32+ char string (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Yes | Full URL of the deployed site |
| `GITHUB_ID` | Yes | OAuth App client ID |
| `GITHUB_SECRET` | Yes | OAuth App client secret |
| `GITHUB_TOKEN` or `AGENT_GITHUB_TOKEN` | Yes | PAT / fine-grained token with `actions:write`, `contents:write`, `pull_requests:write` on the control-plane repo and target repos |
| `CONTROL_PLANE_REPO` | Optional | `owner/repo` of this bot (default already set) |
| `CALLBACK_URL` | Optional | Base for worker callbacks, e.g. `https://<domain>/api/tasks` (worker appends `/{task_id}`) |
| `WORKER_CALLBACK_SECRET` | Recommended | Shared secret so only the Actions worker can PATCH task status |

## 4. Secrets for GitHub Actions (this repository)

Repository → Settings → Secrets and variables → Actions:

| Secret | Purpose |
|--------|--------|
| `LLM_API_KEY` | Free provider key (Groq, Gemini, OpenRouter, …) |
| `LLM_BASE_URL` | Optional OpenAI-compatible base URL |
| `LLM_MODEL` | Optional model name |
| `WORKER_CALLBACK_SECRET` | Same value as control-plane |

`GITHUB_TOKEN` is provided automatically by Actions.

## 5. Deploy control plane

```bash
# Connect the repo to Vercel Hobby (free)
npx vercel --prod
# or use the Vercel dashboard “Import Git Repository”
```

Set all environment variables listed above for Production.

## 6. First run

1. Open the deployed URL on iPhone → Sign in with GitHub.
2. Create a coding task against a repository you own.
3. You are redirected to `/tasks/[id]`.
4. Lock the phone. The Actions job continues.
5. Reopen later — status, commit, and PR link are visible.

## 7. Local development

```bash
npm install
# optional: set DATABASE_URL for real persistence; otherwise in-memory is used
npm run dev
```
