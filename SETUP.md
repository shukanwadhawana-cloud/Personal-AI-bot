# SETUP.md — Exact deployment sequence (₹0)

Follow these steps in order. Do not skip.

---

## 1. Create Neon Free project (database)

1. Go to https://console.neon.tech and sign up (no credit card required).
2. Create a project (any name).
3. Copy the **connection string** (starts with `postgresql://…`).
4. Keep it for step 6 → this becomes `DATABASE_URL`.

---

## 2. Create GitHub OAuth App (user login)

1. https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. Application name: `Personal AI Bot` (or any name).
3. Homepage URL: leave as `http://localhost:3000` for now; you will edit it after deploy.
4. Authorization callback URL: `http://localhost:3000/api/auth/callback/github` (temporary).
5. Register → copy **Client ID** and generate **Client Secret**.
6. Keep them for step 6 → `GITHUB_ID` and `GITHUB_SECRET`.

---

## 3. Generate NEXTAUTH_SECRET

```bash
openssl rand -base64 32
```

Keep the output for step 6.

---

## 4. Generate WORKER_CALLBACK_SECRET

```bash
openssl rand -base64 24
```

You will put the **same value** in both Vercel and GitHub Actions secrets.

---

## 5. Deploy the control plane to Vercel Hobby

1. Go to https://vercel.com → **Add New… → Project**.
2. Import `shukanwadhawana-cloud/Personal-AI-bot`.
3. Framework preset: Next.js (auto-detected).
4. **Do not deploy yet** — first add environment variables (next step).

---

## 6. Vercel environment variables (Production)

In the Vercel project → **Settings → Environment Variables**, add for **Production**:

| Name | Value |
|------|-------|
| `DATABASE_URL` | Neon connection string from step 1 |
| `NEXTAUTH_SECRET` | from step 3 |
| `NEXTAUTH_URL` | `https://<your-vercel-domain>` (you will know this after first deploy) |
| `GITHUB_ID` | OAuth Client ID |
| `GITHUB_SECRET` | OAuth Client Secret |
| `GITHUB_TOKEN` or `AGENT_GITHUB_TOKEN` | Fine-grained PAT with `actions:write`, `contents:write`, `pull_requests:write` on this repo and any target repos |
| `CALLBACK_URL` | `https://<your-vercel-domain>/api/tasks` (base only; task id is appended automatically) |
| `WORKER_CALLBACK_SECRET` | from step 4 |
| `CONTROL_PLANE_REPO` | `shukanwadhawana-cloud/Personal-AI-bot` (optional, already defaulted) |

After the first deploy you will know the exact domain. Update `NEXTAUTH_URL` and `CALLBACK_URL` and also update the OAuth App homepage + callback URLs to:

- Homepage: `https://<your-vercel-domain>`
- Callback: `https://<your-vercel-domain>/api/auth/callback/github`

Then redeploy.

---

## 7. GitHub Actions secrets (this repository)

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|------|-------|
| `LLM_API_KEY` | Free provider key (Groq / Gemini / OpenRouter / …) |
| `LLM_BASE_URL` | Optional, e.g. `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | Optional model name |
| `WORKER_CALLBACK_SECRET` | **Same value** as in Vercel |

`GITHUB_TOKEN` is supplied automatically by Actions; you do not create it.

---

## 8. Fine-grained PAT for the control plane

If the default Vercel `GITHUB_TOKEN` cannot dispatch workflows, create a fine-grained PAT:

- Resource owner: your user
- Repository access: this repo + any repos the agent should modify
- Permissions: **Actions: Read and write**, **Contents: Read and write**, **Pull requests: Read and write**

Store it as `AGENT_GITHUB_TOKEN` (or `GITHUB_TOKEN`) in Vercel.

---

## 9. First real test (safe, small)

1. Open the deployed URL on an iPhone.
2. Sign in with GitHub.
3. Create a task against a repository you own with a **deliberately small prompt**, for example:

   > Add a short section to the README titled “Architecture overview” that describes the control-plane + GitHub Actions design in 3–5 sentences. Do not modify any application source code.

4. Confirm you are redirected to `/tasks/<id>` and status becomes QUEUED then RUNNING.
5. Lock the iPhone / close Safari.
6. Wait 2–10 minutes (depending on free LLM latency).
7. Reopen the app → the same task must still exist and status should have progressed.
8. On GitHub verify: branch `agent/<task-id>`, commit, and open PR.

---

## 10. Local development (optional)

```bash
npm install
# Without DATABASE_URL the in-memory store is used (development only).
# In production DATABASE_URL is mandatory.
npm run dev
```

---

## Distinction that matters

| Location | Variables |
|----------|-----------|
| **Vercel (control plane)** | DATABASE_URL, NEXTAUTH_*, GITHUB_ID/SECRET, AGENT_GITHUB_TOKEN, CALLBACK_URL, WORKER_CALLBACK_SECRET |
| **GitHub Actions secrets** | LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, WORKER_CALLBACK_SECRET |

Never put the LLM key in Vercel unless you also need it for something else. Never put the Neon URL in Actions secrets.
