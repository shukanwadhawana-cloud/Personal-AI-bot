# SECURITY.md

## Threat Model

Target repositories are untrusted. All agent execution happens inside ephemeral GitHub Actions runners.

## Implemented Protections

- **Authentication**: NextAuth + GitHub OAuth. Unauthenticated requests to `/api/tasks` return 401.
- **Authorization**: Tasks are scoped by `user_id`. `getTask` / `listTasks` / `updateTask` filter by the authenticated user. Worker updates require `x-worker-secret`.
- **Input validation**: Zod schema rejects malformed `owner/repo`, oversized prompts, etc.
- **Secrets**: LLM keys, GitHub tokens, DB credentials, OAuth secrets and worker callback secret live only in environment / Actions secrets. Never sent to the browser or to repository code.
- **CSRF**: NextAuth cookies are `SameSite` + secure in production.
- **Least privilege on Actions**: `contents: write`, `pull-requests: write` only.
- **Ephemeral workspace**: `rm -rf workspace` at the end of every job.
- **No permanent repo storage**: Only compact task metadata is kept in Neon.

## Remaining / Future

- Explicit GitHub API check that the authenticated user has write access to the target repository before dispatch.
- Rate limiting on task creation.
- Network egress restrictions inside the agent step.
- Command allow-listing if a more powerful sandbox is introduced.
