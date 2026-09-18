# SETUP.md

## Exact Setup Steps for ₹0 Operation

1. **GitHub**
   - Use this repository (or fork).
   - Create a fine-grained PAT or GitHub App with `contents:write`, `pull_requests:write`, `actions:write`, `metadata:read` on the target repositories you want the agent to work on.
   - Store the token as repository secret `AGENT_GITHUB_TOKEN` if the default `GITHUB_TOKEN` is insufficient for cross-repo work.

2. **LLM Provider (free)**
   - Obtain a free API key from one of: Groq, Google AI Studio (Gemini), OpenRouter free models, etc.
   - Add as repository secret `LLM_API_KEY`.
   - Optionally set `LLM_BASE_URL` and `LLM_MODEL` for OpenAI-compatible providers.

3. **Control Plane Hosting**
   - Connect this repo to Vercel (Hobby) or Cloudflare Pages/Workers.
   - Environment variables: `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET` (for OAuth), `DATABASE_URL` (if using external free DB).

4. **Database (task persistence)**
   - Preferred: Cloudflare D1 (create via dashboard, bind to Worker).
   - Alternative: Neon free Postgres or Supabase free (note possible pause).
   - Run the schema in `lib/schema.sql` (to be added).

5. **Enable the coding-agent workflow**
   - The file `.github/workflows/coding-agent.yml` is already present.
   - It accepts `workflow_dispatch` inputs: task_id, target_repo, prompt, etc.

6. **Mobile / PWA**
   - After deploy, open the site on iPhone/iPad → Share → Add to Home Screen.
   - Use the “New Coding Task” flow.

7. **Test**
   - From the UI submit a safe prompt against a test repository you own.
   - Lock the phone; later reopen and verify the Actions run and PR.
