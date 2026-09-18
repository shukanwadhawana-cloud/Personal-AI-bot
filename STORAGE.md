# STORAGE.md

## Policy

- **Never** permanently store full Git repositories, node_modules, build artifacts, Docker images, screenshots, or large logs.
- Database holds only compact metadata: users, tasks, status, timestamps, commit SHA, PR URL, short summaries, error messages.

## Retention Defaults

| Data | Retention |
|------|-----------|
| Verbose logs | 3 days |
| Task events | 7 days |
| Completed task summaries | 30 days |
| Temporary workspace | Deleted at end of Actions job |
| Repositories | Only on GitHub |

## Resource Guard

The control plane should expose a simple resource-usage page (DB size estimate, task count, recent log volume). Old records are cleaned by a scheduled workflow or on-read soft-delete.
