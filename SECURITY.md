# SECURITY.md

## Threat Model

Every target repository is treated as untrusted. Agent runs only inside GitHub Actions runners (ephemeral, isolated).

## Protections Implemented / Required

- GitHub tokens and LLM keys live only in Actions secrets and server-side env.
- Never logged in plain text.
- Frontend never receives secrets.
- Task ownership: only the authenticated GitHub user who created the task can view/cancel it.
- CSRF protection on state-changing API routes (NextAuth + same-site cookies).
- Rate limiting on task creation (to be enforced in control plane).
- Agent workflow uses least-privilege permissions (`contents: write`, `pull-requests: write`).
- Temporary workspace is destroyed when the job ends.
- No permanent storage of full repositories or node_modules.

## Remaining Hardening (future)

- Network egress restrictions inside the agent step where possible.
- Explicit allow-list of shell commands if using a more powerful sandbox.
- Audit log of every task event retained for 7–30 days only.
