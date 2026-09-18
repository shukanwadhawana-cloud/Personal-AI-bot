# STORAGE.md

## Policy (enforced)

- Database (Neon Free) stores **only** task metadata (id, user, repo name, prompt, status, SHAs, URLs, timestamps, short error/result).
- Full repositories, `node_modules`, build artefacts, screenshots, videos, model weights are **never** written to the database or object storage.
- Worker workspace is deleted at the end of every Actions job.

## Retention

| Data | Retention |
|------|-----------|
| Verbose logs (Actions) | GitHub default (90 days) |
| Task events / metadata | Soft cleanup after 30 days (`cleanupOldTasks`) |
| Temporary workspace | Immediate |

## Resource Guard

- Neon Free: 0.5 GB storage (more than enough for metadata).
- Index on `(user_id, status)` and `updated_at` keeps queries cheap.
- `cleanupOldTasks(days)` can be called from a scheduled workflow later.
