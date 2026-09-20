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
  → GITHUB ACTIONS SPENDING LIMIT (REQUIRED FOR PRIVATE REPOS)
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

You will fix the real URLs in step 8 after Vercel gives you a domain.

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

For the worker to checkout/push **other** repositories, also add the same token as an **Actions repository secret** named `AGENT_GITHUB_TOKEN`.

---

## 5. LLM provider setup — zero-cost first

The worker now supports multiple Aider-compatible providers and automatically avoids repeatedly retrying a quota-exhausted provider.

### Recommended for the ₹0 goal: OpenRouter Free

OpenRouter provides a free tier with free models and an `openrouter/free` router. Free-plan limits can change, so treat it as rate-limited rather than unlimited.

Create an OpenRouter API key at https://openrouter.ai and add this **GitHub Actions secret**:

| Secret | Value |
|---|---|
| `OPENROUTER_API_KEY` | Your OpenRouter key |
| `OPENROUTER_MODEL` | Optional; defaults to `openrouter/free` |

### Groq fallback (zero-cost tier)

Groq exposes an OpenAI-compatible API at `https://api.groq.com/openai/v1`. The worker can use an explicitly configured Groq key as a second zero-cost provider. Available models and limits change over time; the worker defaults to `gpt-oss-20b` and does not assume unlimited usage. citeturn0search0turn1search0

Add this **GitHub Actions secret** if you want Groq enabled:

| Secret | Value |
|---|---|
| `GROQ_API_KEY` | Your Groq key |
| `GROQ_MODEL` | Optional; defaults to `gpt-oss-20b` |

Groq is not automatically upgraded to a paid tier by this project. Paid usage requires you to explicitly configure a paid account/provider yourself.

### DeepSeek fallback

DeepSeek is now supported through Aider's OpenAI-compatible interface. Its current API is usage-priced, so **do not add `DEEPSEEK_API_KEY` if strict ₹0 operation is mandatory**. If you later choose to use it, add the secret and the worker can switch to it when the free provider is unavailable.

| Secret | Value |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key (optional) |
| `DEEPSEEK_MODEL` | Optional; defaults to `deepseek-flash` |

### Gemini remains a fallback

Your existing Gemini secret remains supported:

| Secret | Value |
|---|---|
| `LLM_API_KEY` | Existing Gemini key |

### Provider selection

Leave `LLM_PROVIDER` unset for automatic selection:

``
OpenRouter Free → Groq (if configured) → Gemini
``

You can also force one provider with the optional Actions secret `LLM_PROVIDER` set to `openrouter`, `groq`, `gemini`, or the explicitly opt-in `deepseek` provider.

**Important:** the worker will not invent or create billing credentials. A paid provider is used only when its corresponding secret is explicitly supplied.

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

## 7. GitHub Actions secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value source | Required |
|------|--------------|----------|
| `OPENROUTER_API_KEY` | OpenRouter free key (step 5) | Recommended for ₹0 operation |
| `OPENROUTER_MODEL` | optional; defaults to `openrouter/free` | Optional |
| `GROQ_API_KEY` | Groq key (optional) | Optional |
| `GROQ_MODEL` | optional; defaults to `gpt-oss-20b` | Optional |
| `DEEPSEEK_API_KEY` | optional DeepSeek key | Optional; usage-priced |
| `DEEPSEEK_MODEL` | optional; defaults to `deepseek-flash` | Optional |
| `LLM_API_KEY` | existing Gemini key | Optional fallback |
| `LLM_PROVIDER` | optional forced provider | Optional |
| `WORKER_CALLBACK_SECRET` | **same value** as in Vercel (step 3) | Yes |
| `AGENT_GITHUB_TOKEN` | same PAT as step 4 (for cross-repo checkout/push) | Recommended |

Do **not** put `DATABASE_URL`, `GITHUB_SECRET`, or `NEXTAUTH_SECRET` here.

`GITHUB_TOKEN` is supplied automatically by Actions — you do not create it.

---

## 8. GitHub Actions spending limit (REQUIRED for private repositories)

This repository is **private**. GitHub-hosted runners for private repos are gated by the account **Actions spending limit**.

If the spending limit is **$0** (the default for many Free accounts), every job fails **before any step runs** with:

- `runner_id: 0`
- empty `runner_name`
- no logs
- conclusion `failure` in a few seconds

**Fix (one time):**

1. Open https://github.com/settings/billing/summary  
   (or Settings → Billing and plans → Plans and usage → Actions / Spending limits)
2. Set the **Actions spending limit** to at least **$1** (or “No limit” if you prefer).
3. Ensure a payment method is on file if GitHub asks for one.
4. Wait 1–2 minutes, then re-run **Minimal Runner Test** from the Actions tab.

You still get the free monthly minutes (2 000 on Free). A non-zero spending limit only allows the free entitlement to be used and covers any tiny overage.

Without this step the control plane can dispatch workflows, but no runner will ever start.

---

## 9. Fix OAuth + NEXTAUTH_URL + CALLBACK_URL, then redeploy

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

## 10. First test on iPhone

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
| AGENT_GITHUB_TOKEN | GitHub fine-grained PAT | Vercel env **and** Actions secrets |
| LLM_API_KEY (+ optional BASE/MODEL) | LLM provider | **Actions secrets only** |
| NEXTAUTH_URL / CALLBACK_URL | after Vercel domain known | Vercel env |
| OAuth Homepage + Callback URLs | after Vercel domain known | GitHub OAuth App settings |
| Actions spending limit | GitHub Billing | ≥ $1 for private repos |

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

The worker changes a task to RUNNING only after its `Report RUNNING` callback succeeds. The worker also enforces a per-task LLM call budget and records provider/model/call-count metadata in the final callback.

### Jobs fail in seconds with no logs / runner_id 0

This is almost always the **Actions spending limit** on a private repository (see step 8). It is not a YAML or code defect.
