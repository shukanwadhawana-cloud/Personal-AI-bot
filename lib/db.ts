/**
 * Database abstraction — Neon Free (serverless Postgres).
 * Only task metadata is stored. Never repository contents.
 *
 * Env: DATABASE_URL (Neon connection string)
 * When DATABASE_URL is absent the in-memory fallback in tasks.ts is used.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';

let sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> | null {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

export async function ensureSchema(): Promise<void> {
  const db = getSql();
  if (!db) return;

  await db`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      repository    TEXT NOT NULL,
      title         TEXT,
      prompt        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'QUEUED',
      branch        TEXT NOT NULL DEFAULT 'main',
      commit_sha    TEXT,
      pr_url        TEXT,
      deployment_url TEXT,
      worker_run_id TEXT,
      error         TEXT,
      result        TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      worker_lease  TEXT,
      heartbeat_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Indexes for ownership + status queries and cleanup
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks (user_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`;
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks (updated_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status)`;
}
