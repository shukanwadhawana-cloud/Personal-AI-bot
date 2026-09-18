# SETUP.md — Foolproof deployment (₹0)

**Do not paste any secret into this repository or into chat.**  
Generate secrets on your own machine and enter them only in Vercel / GitHub / Neon UIs.

---

## QUICK START FOR IPHONE

```
NEON
  → GITHUB OAUTH APP
  → GENERATE 2 SECRETS (local)
  → CREATE FINE-GRAINED PAT (optional but recommended)
  → VERCEL DEPLOY + ENV VARS
  → GITHUB ACTIONS SECRETS
  → UPDATE OAUTH CALLBACK + REDEPLOY
  → FIRST TEST ON IPHONE
```

Follow the numbered sections below in order.

---

## 1. Neon Free (database)

| What | Where |
|------|--------|
| Account | https://console.neon.tech (sign up, no credit card) |
| Action | Create a project → copy the **connection string** |
| Becomes | `DATABASE_URL` |
| Goes into | **Vercel → Environment Variables** only |

Example format (do not use this value):  
`postgresql://user:xxxxx@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`

---

## 2. GitHub OAuth App (login)

1. Open https://github.com/settings/developers  
2. **OAuth Apps** → **New OAuth App**
3. Fill in:

| Field | Value for first registration |
|-------|------------------------------|
| Application name | `Personal AI Bot` |
| Homepage URL | `https://placeholder.vercel.app` (temporary) |
| Authorization callback URL | `https://placeholder.vercel.app/api/auth/callback/github` (temporary) |

4. Click **Register application**
5. Copy **Client ID** → this is `GITHUB_ID`
6. Click **Generate a new client secret** → copy once → this is `GITHUB_SECRET`  
   (you cannot see it again)

You will fix the real URLs in step 7 after Vercel gives you a domain.

---

## 3. Generate secrets on your machine

Run these **locally** (Terminal / PowerShell). **Do not send the output anywhere.**

```bash
# NEXTAUTH_SECRET (required)
openssl rand -base64 32

# WORKER_CALLBACK_SECRET (required — same value used in TWO places)
openssl rand -base64 24
```

If you do not have `openssl`, use any secure random generator of 32+ characters.  
Keep both values in a password manager until you paste them into the UIs below.

---

## 4. Fine-grained PAT (recommended for dispatch)

The control plane needs a token that can trigger GitHub Actions on this repo.

1. https://github.com/settings/tokens?type=beta → **Generate new token**
2. Token name: `personal-ai-bot-control`
3. Expiration: 90 days (or your preference)
4. Repository access: **Only select repositories** → choose `Personal-AI-bot` + any repos the agent may edit
5. Permissions:
   - **Actions**: Read and write
   - **Contents**: Read and write
   - **Pull requests**: Read and write
6. Generate → copy once → this becomes `AGENT_GITHUB_TOKEN`

Goes into: **Vercel Environment Variables only** (never into Actions secrets for this purpose).

---

## 5. Free LLM key (for the worker)

Pick one free provider and create an API key (do this yourself):

- Groq: https://console.groq.com  
- Google AI Studio (Gemini): https://aistudio.google.com  
- OpenRouter free models: https://openrouter.ai  

The key becomes `LLM_API_KEY`.  
Goes into: **GitHub Actions secrets only** (not Vercel).

Optional companions:
- `LLM_BASE_URL` — e.g. `https://api.groq.com/openai/v1`
- `LLM_MODEL` — e.g. the model name your provider documents

---

## 6. Vercel deploy + environment variables

1. https://vercel.com → **Add New… → Project**
2. Import `shukanwadhawana-cloud/Personal-AI-bot`
3. Framework: Next.js (auto)
4. **Before the first deploy**, open **Environment Variables** and add for **Production**:

| Variable | Value source | Required |
|----------|--------------|----------|
| `DATABASE_URL` | Neon connection string (step 1) | Yes |
| `NEXTAUTH_SECRET` | generated in step 3 | Yes |
| `NEXTAUTH_URL` | leave blank for first deploy, or set after you know the domain | Yes (after domain known) |
| `GITHUB_ID` | OAuth Client ID (step 2) | Yes |
| `GITHUB_SECRET` | OAuth Client Secret (step 2) | Yes |
| `AGENT_GITHUB_TOKEN` | fine-grained PAT (step 4) | Yes for dispatch |
| `CALLBACK_URL` | `https://YOUR-DOMAIN.vercel.app/api/tasks` (after domain known) | Recommended |
| `WORKER_CALLBACK_SECRET` | generated in step 3 | Yes |
| `CONTROL_PLANE_REPO` | `shukanwadhawana-cloud/Personal-AI-bot` | Optional (has default) |

5. Click **Deploy**.
6. After deploy succeeds, copy the production URL (e.g. `https://personal-ai-bot-xxxx.vercel.app`).

---

## 7. Fix OAuth + NEXTAUTH_URL + CALLBACK_URL, then redeploy

### A. GitHub OAuth App

Edit the OAuth App you created:

| Field | New value |
|-------|-----------|
| Homepage URL | `https://YOUR-DOMAIN.vercel.app` |
| Authorization callback URL | `https://YOUR-DOMAIN.vercel.app/api/auth/callback/github` |

### B. Vercel environment variables

Update / set:

| Variable | Value |
|----------|-------|
| `NEXTAUTH_URL` | `https://YOUR-DOMAIN.vercel.app` |
| `CALLBACK_URL` | `https://YOUR-DOMAIN.vercel.app/api/tasks` |

(No trailing slash on the domain.)

### C. Redeploy

Vercel → Deployments → … on the latest → **Redeploy** (so the new env vars take effect).

---

## 8. GitHub Actions secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value source | Required |
|------|--------------|----------|
| `LLM_API_KEY` | free provider key (step 5) | Yes for real agent work |
| `LLM_BASE_URL` | optional provider base URL | Optional |
| `LLM_MODEL` | optional model name | Optional |
| `WORKER_CALLBACK_SECRET` | **same value** as in Vercel (step 3) | Yes |

Do **not** put `DATABASE_URL`, `GITHUB_SECRET`, or `NEXTAUTH_SECRET` here.

`GITHUB_TOKEN` is supplied automatically by Actions — you do not create it.

---

## 9. First test on iPhone

1. Open `https://YOUR-DOMAIN.vercel.app` in Safari on your iPhone.
2. Tap **Sign in with GitHub** and authorize.
3. Tap **+ New Coding Task**.
4. Repository: a repo **you own** (format `owner/name`).
5. Branch: `main` (or your default).
6. Prompt (copy exactly for the first run):

```
Add a short section to the README titled "Architecture overview" that describes the control-plane plus GitHub Actions design in 3 to 5 sentences. Do not modify any application source code.
```

7. Tap **START**. You should land on `/tasks/<id>` with status QUEUED then RUNNING.
8. Lock the phone / leave Safari.
9. Wait 3–15 minutes.
10. Reopen the site → the same task must still be there and status should have moved (PR_CREATED / COMPLETED / FAILED).
11. On GitHub check for branch `agent/<task-id>` and an open PR.

---

## Where each value lives (summary)

| Value | Create in | Enter in |
|-------|-----------|----------|
| Neon connection string | Neon console | Vercel env → `DATABASE_URL` |
| OAuth Client ID | GitHub OAuth App | Vercel env → `GITHUB_ID` |
| OAuth Client Secret | GitHub OAuth App | Vercel env → `GITHUB_SECRET` |
| NEXTAUTH_SECRET | local `openssl` | Vercel env |
| WORKER_CALLBACK_SECRET | local `openssl` | **Both** Vercel env **and** Actions secrets |
| AGENT_GITHUB_TOKEN | GitHub fine-grained PAT | Vercel env |
| LLM_API_KEY (+ optional BASE/MODEL) | LLM provider | **Actions secrets only** |
| NEXTAUTH_URL / CALLBACK_URL | after Vercel domain known | Vercel env |
| OAuth Homepage + Callback URLs | after Vercel domain known | GitHub OAuth App settings |

---

## Local development (optional)

```bash
git clone https://github.com/shukanwadhawana-cloud/Personal-AI-bot.git
cd Personal-AI-bot
npm install
npm run dev
```

Without `DATABASE_URL` the app uses an in-memory store (development only). Production always requires Neon.


## Dispatch troubleshooting

A task is **QUEUED** until the GitHub Actions worker sends its first callback. The control plane must not mark a task RUNNING merely because GitHub accepted a workflow-dispatch request.

If GitHub OAuth is used for dispatch, re-authorize the app after changing its scope so the account receives the `workflow` scope. For cross-repository worker checkout/push, add the same fine-grained `AGENT_GITHUB_TOKEN` as an **Actions repository secret**; the built-in `GITHUB_TOKEN` is scoped to the control-plane repository.

The worker changes a task to RUNNING only after its `Report RUNNING` callback succeeds.
